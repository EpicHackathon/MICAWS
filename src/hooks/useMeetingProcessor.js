import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { processTranscript } from '../services/processTranscript.js';
import { emptyMeetingState } from '../shared/meetingSchema.js';

// A failed AI map update retries by itself: wait 1s, then 2s, 4s... (then every 30s) until it works.
const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000];
const freshMeeting = () => ({
  state: emptyMeetingState, cursor: 0, request: null, editsDuringRequest: [], failures: 0, retryTimer: null,
});

// paused: while someone is editing the map, hold AI map updates. Recording and the transcript
// keep going; when paused turns off, everything said in the meantime is processed at once.
export function useMeetingProcessor(segments, isRecording, intervalMs = 10_000, { paused = false } = {}) {
  const [state, setState] = useState(emptyMeetingState);
  const [error, setError] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  // editsDuringRequest: hand edits made while the AI is working; replayed on its answer.
  const meeting = useRef(freshMeeting());
  const latest = useRef({ segments, isRecording, paused });

  useLayoutEffect(() => {
    latest.current = { segments, isRecording, paused };
  }, [segments, isRecording, paused]);

  const processPending = useCallback(async function drain() {
    const current = meeting.current;
    const end = latest.current.segments.length;
    if (latest.current.paused) return;   // map is being edited: notes wait, nothing is lost
    if (current.request || end <= current.cursor) return;

    clearTimeout(current.retryTimer);   // running now, so a scheduled retry isn't needed
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
      current.failures = 0;
      succeeded = true;
    } catch (cause) {
      if (meeting.current === current) {
        // Nothing is lost (the cursor didn't move): try the same lines again after a pause.
        const delay = RETRY_DELAYS_MS[Math.min(current.failures, RETRY_DELAYS_MS.length - 1)];
        current.failures += 1;
        setError(`${cause.message || 'Processing failed.'} Retrying automatically in ${Math.round(delay / 1000)}s.`);
        current.retryTimer = setTimeout(() => { void drain(); }, delay);
      }
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
  }, [isRecording, segments.length, paused, processPending]);   // un-pausing catches up

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
    meeting.current = freshMeeting();
    clearTimeout(old.retryTimer);
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

  // Transcript lines said but not yet on the map (shown while editing pauses updates).
  const pendingCount = Math.max(0, segments.length - meeting.current.cursor);

  return { state, isProcessing, error, processPending, reset, applyEdit, pendingCount };
}
