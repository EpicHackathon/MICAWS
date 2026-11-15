import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { processTranscript } from '../services/processTranscript.js';
import { emptyMeetingState } from '../shared/meetingSchema.js';

// A failed AI map update retries by itself: wait 1s, then 2s, 4s... (then every 30s) until it works.
// (exported as one object so tests can shrink the waits)
export const processorTiming = {
  retryDelays: [1000, 2000, 4000, 8000, 15000, 30000],
  // Gemini usage limit reached (HTTP 429): retrying fast only burns more of the limit, so wait longer.
  limitDelays: [30000, 60000],
  // While recording, call the AI at most once every 20s (more speech per call = fewer calls).
  minGapWhileRecording: 20000,
};
// locked: ids of topics people edited by hand; sent with every update so the AI leaves them alone.
const freshMeeting = () => ({
  state: emptyMeetingState, cursor: 0, request: null, editsDuringRequest: [], failures: 0, retryTimer: null,
  locked: new Set(), lastCallAt: 0, limited: false,
});

// Topics an edit added, renamed, rewrote or moved.
function changedIds(before, after) {
  const old = new Map(before.nodes.map(node => [node.id, node]));
  return after.nodes.filter(node => {
    const prev = old.get(node.id);
    return !prev || prev.label !== node.label || prev.summary !== node.summary || prev.parentId !== node.parentId;
  }).map(node => node.id);
}

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
    if (current.retryTimer && current.limited) return;   // waiting out Gemini's limit: don't call early

    // While recording, space calls out; the lines wait and go in the next call (nothing is lost).
    const sinceLast = Date.now() - current.lastCallAt;
    if (latest.current.isRecording && sinceLast < processorTiming.minGapWhileRecording) {
      if (!current.retryTimer) {
        current.retryTimer = setTimeout(() => { current.retryTimer = null; void drain(); },
          processorTiming.minGapWhileRecording - sinceLast);
      }
      return;
    }

    clearTimeout(current.retryTimer);   // running now, so a scheduled retry isn't needed
    current.retryTimer = null;
    current.limited = false;
    current.lastCallAt = Date.now();
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
        { signal: controller.signal, lockedIds: [...current.locked] },
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
        const limited = cause.status === 429;
        const delays = limited ? processorTiming.limitDelays : processorTiming.retryDelays;
        const delay = delays[Math.min(current.failures, delays.length - 1)];
        current.failures += 1;
        current.limited = limited;
        setError(limited
          ? `Gemini's usage limit was reached. Nothing is lost: the map catches up automatically in ${Math.round(delay / 1000)}s.`
          : `${cause.message || 'Processing failed.'} Retrying automatically in ${Math.round(delay / 1000)}s.`);
        current.retryTimer = setTimeout(() => { current.retryTimer = null; void drain(); }, delay);
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
    for (const id of changedIds(current.state, next)) current.locked.add(id);
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
