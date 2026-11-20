import { postMeetingJson } from './postMeetingJson.js';
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

  const body = await postMeetingJson('/api/process', input.data, options.signal, {
    timeout: 'Processing timed out. Retry the pending transcript.',
    connection: 'Could not reach the processing server. Check your connection and retry.',
    failure: 'Processing failed',
  });
  const result = meetingSchema.safeParse(body);
  if (!result.success) throw new Error('The server returned an invalid meeting state.');
  return result.data;
}
