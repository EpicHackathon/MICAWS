import { emptyMeetingState, meetingSchema, requestSchema } from '../shared/meetingSchema.js';
import type { MeetingState, MeetingRequest } from '../shared/meetingSchema.js';

type ProcessOptions = Partial<Omit<MeetingRequest, 'newSegments' | 'previousState'>> & {
  signal?: AbortSignal;
};

type Segment = MeetingRequest['newSegments'][number];

export async function processTranscript(
  newSegments: Segment[],
  previousState: MeetingState = emptyMeetingState,
  options: ProcessOptions = {},
): Promise<MeetingState> {
  const input = requestSchema.safeParse({
    newSegments,
    previousState,
    ...Object.fromEntries((['materials', 'outputLanguage', 'deletedNodes', 'deletedTaskIds', 'lockedTaskIds'] as const).filter(key => options[key] !== undefined).map(key => [key, options[key]])),
    ...(options.lockedIds?.length ? { lockedIds: options.lockedIds } : {}),
    ...(options.historicalContext ? { historicalContext: options.historicalContext } : {}),
    ...(options.reassessment ? { reassessment: true } : {}),
  });
  if (!input.success) throw new Error('Invalid transcript or meeting state. Check the segment format.');
  if (!newSegments.some(segment => segment.text.trim()) && !input.data.reassessment) {
    return input.data.previousState;
  }

  const timeout = AbortSignal.timeout(180_000);
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
    const failure = new Error(typeof body?.error === 'string' ? body.error : `Processing failed (HTTP ${response.status}).`) as Error & { status?: number };
    failure.status = response.status;   // 429 = Gemini usage limit reached
    throw failure;
  }
  const result = meetingSchema.safeParse(body);
  if (!result.success) throw new Error('The server returned an invalid meeting state.');
  return result.data;
}
