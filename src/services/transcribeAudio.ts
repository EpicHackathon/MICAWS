export type TranscriptionSegment = {
  text: string;
  start: number;
  end: number;
  speaker: string | null;
};

type TranscriptionOptions = {
  chunkId?: string;
  startSeconds?: number;
  language?: string;
};

export async function transcribeAudio(
  audio: Blob,
  signal?: AbortSignal,
  { chunkId = crypto.randomUUID(), startSeconds = 0, language = 'auto' }: TranscriptionOptions = {},
): Promise<TranscriptionSegment[]> {
  const form = new FormData();
  form.append('audio', audio, 'recording.wav');
  form.append('chunk_id', chunkId);
  form.append('start_seconds', String(startSeconds));
  form.append('language', language);
  const timeout = AbortSignal.timeout(120_000);
  let response;
  try {
    response = await fetch('/api/transcribe', {
      method: 'POST', body: form, signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error(timeout.aborted
      ? 'Transcription timed out.' : 'Could not reach the transcription server. Check the Python terminal.');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof result?.detail === 'string'
      ? result.detail : `Transcription failed (HTTP ${response.status}). Check the Python server.`);
  }
  if (!Array.isArray(result) || !result.every(segment =>
    segment !== null && typeof segment === 'object' && typeof segment.text === 'string' && Number.isFinite(segment.start) && segment.start >= 0
    && Number.isFinite(segment.end) && segment.end >= segment.start
    && (segment.speaker === null || typeof segment.speaker === 'string'))) {
    throw new Error('The transcription server returned an invalid response.');
  }
  return result as TranscriptionSegment[];
}
