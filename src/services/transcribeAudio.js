export async function transcribeAudio(audio, signal, { chunkId = crypto.randomUUID(), startSeconds = 0 } = {}) {
  const form = new FormData();
  form.append('audio', audio, 'recording.wav');
  form.append('chunk_id', chunkId);
  form.append('start_seconds', String(startSeconds));
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
    typeof segment.text === 'string' && Number.isFinite(segment.start) && segment.start >= 0
    && Number.isFinite(segment.end) && segment.end >= segment.start
    && (segment.speaker === null || typeof segment.speaker === 'string'))) {
    throw new Error('The transcription server returned an invalid response.');
  }
  return result;
}
