import { postMeetingJson } from './postMeetingJson.js';
import { summaryRequestSchema, summarySchema } from '../shared/summarySchema.js';
import type { SummaryRequest, MeetingSummary } from '../shared/summarySchema.js';

type SummaryOptions = {
  signal?: AbortSignal;
  context?: Partial<Omit<SummaryRequest, 'segments' | 'state'>>;
};

// Ask the server for the end-of-meeting summary: { overview, keyPoints, nextTime }.
export async function summarizeMeeting(
  segments: SummaryRequest['segments'],
  state: SummaryRequest['state'],
  { signal, context = {} }: SummaryOptions = {},
): Promise<MeetingSummary> {
  const input = summaryRequestSchema.safeParse({ segments, state, ...context });
  if (!input.success) throw new Error('Could not build the summary request.');
  const body = await postMeetingJson('/api/summary', input.data, signal, {
    timeout: 'The summary took too long.',
    connection: 'Could not reach the server for the summary.',
    failure: 'Summary failed',
  });
  const result = summarySchema.safeParse(body);
  if (!result.success) throw new Error('The server returned an invalid summary.');
  return result.data;
}
