export type TranscriptSegment = {
  time: number;
  speaker: string | null;
  text: string;
};

import type { MeetingState } from '../shared/meetingSchema';

export type MeetingEdit = (state: MeetingState) => MeetingState;
export type MeetingEditHandler = (edit: MeetingEdit) => void;
