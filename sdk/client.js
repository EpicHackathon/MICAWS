/** Server credentials belong in the partner backend. Browsers receive only short-lived sessions. */
export function createMicawsClient({ baseUrl = "", token, fetchImpl = fetch }) {
  async function request(
    path,
    { method = "GET", body, revision, signal, idempotencyKey } = {},
  ) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${typeof token === "function" ? token() : token}`,
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(revision !== undefined && { "If-Match": String(revision) }),
        ...(idempotencyKey && { "Idempotency-Key": idempotencyKey }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(data.error || "Request failed."), {
        status: response.status,
      });
    return data;
  }
  const path = (id) => `/api/v1/meetings/${encodeURIComponent(id)}`;
  return {
    request,
    session: () => request("/api/v1/session"),
    list: () => request("/api/v1/meetings"),
    create: ({ title, series = "", id = crypto.randomUUID() }) =>
      request("/api/v1/meetings", {
        method: "POST",
        body: { id, title, series },
      }),
    get: (id) => request(path(id)),
    issueSession: (meetingId, role = "viewer") =>
      request("/api/v1/sessions", {
        method: "POST",
        body: { meetingId, role },
      }),
    command: (id, revision, command, idempotencyKey) =>
      request(`${path(id)}/commands`, {
        method: "POST",
        revision,
        body: command,
        idempotencyKey,
      }),
    search: (id, query) =>
      request(`${path(id)}/search?q=${encodeURIComponent(query)}`),
    ask: (id, question) =>
      request(`${path(id)}/ask`, { method: "POST", body: { question } }),
    remove: (id) => request(path(id), { method: "DELETE" }),
    async recording(id) {
      const response = await fetchImpl(`${baseUrl}${path(id)}/recording`, {
        headers: {
          Authorization: `Bearer ${typeof token === "function" ? token() : token}`,
        },
      });
      if (!response.ok) throw new Error("Recording could not be loaded.");
      return response.blob();
    },
    async uploadRecording(id, revision, file) {
      const response = await fetchImpl(`${baseUrl}${path(id)}/recording`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${typeof token === "function" ? token() : token}`,
          "If-Match": String(revision),
          "Content-Type": "audio/wav",
        },
        body: file,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data;
    },
    async watch(id, onRevision, signal, onStatus = () => {}) {
      let cursor = 0;
      while (!signal.aborted) {
        try {
          const response = await fetchImpl(
            `${baseUrl}${path(id)}/events?after=${cursor}`,
            {
              headers: {
                Authorization: `Bearer ${typeof token === "function" ? token() : token}`,
              },
              signal,
            },
          );
          if (!response.ok) {
            if ([401, 403, 404].includes(response.status)) {
              onStatus("Session expired or meeting unavailable. Reconnect.");
              return;
            }
            throw new Error("Disconnected");
          }
          onStatus("Connected");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = "";
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              let boundary;
              while ((boundary = buffer.indexOf("\n\n")) >= 0) {
                const event = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                const eventId = event.match(/^id: (\d+)$/m);
                const data = event.match(/^data: (.+)$/m);
                if (eventId && data) {
                  await onRevision(JSON.parse(data[1]));
                  cursor = Number(eventId[1]);
                }
              }
            }
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        } catch {
          if (!signal.aborted)
            onStatus("Reconnecting… Saved changes are safe.");
        }
        if (!signal.aborted)
          await new Promise((resolve) => {
            const timer = setTimeout(done, 1500);
            function done() {
              clearTimeout(timer);
              signal.removeEventListener("abort", done);
              resolve();
            }
            signal.addEventListener("abort", done, { once: true });
          });
      }
    },
  };
}
