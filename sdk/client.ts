import type { Citation, MeetingCommand, SavedMeeting, SavedSegment, WorkspaceMeeting } from "../src/shared/savedMeeting.js";

export type WorkspaceRole = "viewer" | "editor";
export type WorkspaceSession = {
  org: string;
  role: WorkspaceRole;
  meetingId: string | null;
  expiresAt: number | null;
};
export type MeetingListItem = Pick<SavedMeeting, "id" | "title" | "series" | "status" | "revision" | "decisions"> & {
  updatedAt: string;
  tasks: (SavedMeeting["state"]["actionItems"][number] & { status: SavedMeeting["taskStatus"][string] })[];
};
export type SearchHit = SavedSegment & { score: number };
export type MeetingAnswer = { answer: string; citations: Citation[] };
type RequestOptions = {
  method?: string;
  body?: unknown;
  revision?: number;
  signal?: AbortSignal;
  idempotencyKey?: string;
};

/** Server credentials belong in the partner backend. Browsers receive only short-lived sessions. */
export function createMicawsClient({ baseUrl = "", token, fetchImpl = fetch }: { baseUrl?: string; token: string | (() => string); fetchImpl?: typeof fetch }) {
  async function request<T>(
    path: string,
    { method = "GET", body, revision, signal, idempotencyKey }: RequestOptions = {},
  ): Promise<T> {
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
  const path = (id: string) => `/api/v1/meetings/${encodeURIComponent(id)}`;
  return {
    request,
    session: () => request<WorkspaceSession>("/api/v1/session"),
    list: () => request<MeetingListItem[]>("/api/v1/meetings"),
    create: ({ title, series = "", id = crypto.randomUUID() }: { title: string; series?: string; id?: string }) =>
      request<WorkspaceMeeting>("/api/v1/meetings", {
        method: "POST",
        body: { id, title, series },
      }),
    get: (id: string, signal?: AbortSignal) => request<WorkspaceMeeting>(path(id), { signal }),
    issueSession: (meetingId: string | null, role: WorkspaceRole = "viewer") =>
      request<{ token: string; expiresAt: number }>("/api/v1/sessions", {
        method: "POST",
        body: { meetingId, role },
      }),
    command: (id: string, revision: number, command: MeetingCommand, idempotencyKey?: string) =>
      request<WorkspaceMeeting>(`${path(id)}/commands`, {
        method: "POST",
        revision,
        body: command,
        idempotencyKey,
      }),
    search: (id: string, query: string) =>
      request<SearchHit[]>(`${path(id)}/search?q=${encodeURIComponent(query)}`),
    ask: (id: string, question: string) =>
      request<MeetingAnswer>(`${path(id)}/ask`, { method: "POST", body: { question } }),
    remove: (id: string) => request<{ deleted: boolean }>(path(id), { method: "DELETE" }),
    async recording(id: string) {
      const response = await fetchImpl(`${baseUrl}${path(id)}/recording`, {
        headers: {
          Authorization: `Bearer ${typeof token === "function" ? token() : token}`,
        },
      });
      if (!response.ok) throw new Error("Recording could not be loaded.");
      return response.blob();
    },
    async uploadRecording(id: string, revision: number, file: BodyInit): Promise<WorkspaceMeeting> {
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
    async watch(id: string, onRevision: (event: { revision: number }) => void | Promise<void>, signal: AbortSignal, onStatus: (status: string) => void = () => {}) {
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
          if (!response.body) throw new Error("Disconnected");
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
          await new Promise<void>((resolve) => {
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
