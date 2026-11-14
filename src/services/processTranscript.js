import { emptyMeetingState, meetingSchema, requestSchema } from '../shared/meetingSchema.js';

export async function processTranscript(newSegments, previousState = emptyMeetingState, options = {}) {
  const input = requestSchema.safeParse({ newSegments, previousState });
  if (!input.success) throw new Error('Invalid transcript or meeting state. Check the segment format.');
  if (!newSegments.some(segment => segment.text.trim())) return input.data.previousState;

  const timeout = AbortSignal.timeout(55_000);
  let response;
  try {
    response = await fetch('/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input.data),
      signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
  } catch (cause) {
    if (options.signal?.aborted) throw cause;
    if (timeout.aborted) throw new Error('Processing timed out. Retry the pending transcript.');
    throw new Error('Could not reach the processing server. Check your connection and retry.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `Processing failed (HTTP ${response.status}).`);
  }
  const result = meetingSchema.safeParse(body);
  if (!result.success) throw new Error('The server returned an invalid meeting state.');
  return result.data;
}
