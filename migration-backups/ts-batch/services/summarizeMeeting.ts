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
  const timeout = AbortSignal.timeout(180_000);
  let response;
  try {
    response = await fetch('/api/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input.data),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error(timeout.aborted ? 'The summary took too long.' : 'Could not reach the server for the summary.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(typeof body?.error === 'string' ? body.error : `Summary failed (HTTP ${response.status}).`), { status: response.status });
  const result = summarySchema.safeParse(body);
  if (!result.success) throw new Error('The server returned an invalid summary.');
  return result.data;
}
