import { emptyMeetingState, meetingSchema } from '../shared/meetingSchema.js';

export async function processTranscript(newSegments, previousState = emptyMeetingState, options = {}) {
  const response = await fetch('/api/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newSegments, previousState }),
    signal: options.signal ?? AbortSignal.timeout(55_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof body?.error === 'string' ? body.error : `Processing failed (HTTP ${response.status}).`);
  }
  const result = meetingSchema.safeParse(body);
  if (!result.success) throw new Error('The server returned an invalid meeting state.');
  return result.data;
}
