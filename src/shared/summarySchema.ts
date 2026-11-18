import { z } from 'zod';
import { meetingSchema } from './meetingSchema.js';
import { contextFields } from './contextSchema.js';

// End-of-meeting summary: a short overview paragraph + a few key points.
const text = z.string().refine(value => value.trim().length > 0, 'Expected nonblank text');
const summaryShape = z.strictObject({
  overview: text,
  keyPoints: z.array(text).max(8),
  // "For next time": open questions, postponed decisions, things to check on at the next meeting.
  nextTime: z.array(text).max(6),
});
export const summarySchema = summaryShape;

// Sent to Gemini as the answer format.
export const summaryJsonSchema = z.toJSONSchema(summaryShape, { target: 'draft-7' });
delete summaryJsonSchema.$schema;

export const summaryRequestSchema = z.strictObject({
  ...contextFields,
  segments: z.array(z.strictObject({
    time: z.number().nonnegative(), speaker: z.string().nullable(), text: z.string(),
  })),
  state: meetingSchema,
});


export type MeetingSummary = z.infer<typeof summarySchema>;
export type SummaryRequest = z.infer<typeof summaryRequestSchema>;
