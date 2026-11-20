export async function postMeetingJson(
  path: string,
  input: unknown,
  signal: AbortSignal | undefined,
  messages: { timeout: string; connection: string; failure: string },
): Promise<unknown> {
  const timeout = AbortSignal.timeout(180_000);
  let response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new Error(timeout.aborted ? messages.timeout : messages.connection);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof body?.error === 'string'
      ? body.error
      : `${messages.failure} (HTTP ${response.status}).`;
    throw Object.assign(new Error(message), { status: response.status });
  }
  return body;
}
