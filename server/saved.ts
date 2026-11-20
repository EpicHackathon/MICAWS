import express, { type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { z } from "zod";
import { fail, searchTranscript, type SavedMeeting, type WorkspaceMeeting } from "../src/shared/savedMeeting.js";
import { authorize, type createAuth } from "./auth.js";
import type { objectStorage } from "./objects.js";
import type { createProvider } from "./provider.js";
import type { MeetingStore } from "./store.js";

export type SavedApiDependencies = {
  store: MeetingStore;
  auth: ReturnType<typeof createAuth>;
  provider: ReturnType<typeof createProvider>;
  objects: ReturnType<typeof objectStorage>;
};

const uuid = z.string().uuid();
function publicMeeting(m: SavedMeeting): WorkspaceMeeting {
  return {
    ...m,
    recording: m.recording
      ? {
          type: m.recording.type,
          size: m.recording.size,
          offset: m.recording.offset,
        }
      : null,
  };
}
async function readBody(req: Request, limit: number) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, "Upload exceeds the allowed size.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(req: Request) {
  try {
    return JSON.parse((await readBody(req, 1048576)).toString());
  } catch (e) {
    if ((e as { status?: number } | null)?.status) throw e;
    fail(400, "Send valid JSON.");
  }
}

function revision(req: Request) {
  const value = req.headers["if-match"];
  if (!/^\d+$/.test(value || ""))
    fail(428, "Send the meeting revision in If-Match.");
  return Number(value);
}

type ApiLocals = {
  requestId: string;
  started: number;
  principal: ReturnType<ReturnType<typeof createAuth>["read"]>;
  meeting: SavedMeeting;
};
type ApiResponse = Response<unknown, ApiLocals>;

export function createSavedRouter({ store, auth, provider, objects }: SavedApiDependencies) {
  const router = express.Router({ caseSensitive: true, strict: true });
  const buckets = new Map<string, { minute: number; count: number }>();
  function rate(key: string, limit: number) {
    const minute = Math.floor(Date.now() / 60000);
    if (buckets.size > 10000)
      for (const [k, v] of buckets) if (v.minute !== minute) buckets.delete(k);
    const previous = buckets.get(key);
    const b = previous?.minute === minute ? previous : { minute, count: 0 };
    b.count++;
    buckets.set(key, b);
    if (b.count > limit) fail(429, "Too many requests. Retry shortly.");
  }
  router.use((req, res: ApiResponse, next) => {
    const principal = auth.read(req.headers.authorization);
    rate(principal.org, 1200);
    res.locals.principal = principal;
    next();
  });

  router.get("/api/v1/session", (_req, res: ApiResponse) => {
    const { principal } = res.locals;
    return res.status(200).json({
      org: principal.org,
      role: principal.role,
      meetingId: principal.meetingId,
      expiresAt: principal.exp ? principal.exp * 1000 : null,
    });
  });
  router.post("/api/v1/sessions", async (req, res: ApiResponse) => {
    const { principal } = res.locals;
    const input = z
      .strictObject({
        meetingId: uuid.nullable().default(null),
        role: z.enum(["viewer", "editor"]).default("viewer"),
      })
      .parse(await jsonBody(req));
    if (!principal.service)
      fail(403, "Only the partner backend may issue sessions.");
    if (input.meetingId) await store.get(principal.org, input.meetingId);
    return res.status(201).json(auth.issue(principal, input));
  });

  router.get("/api/v1/meetings", async (_req, res: ApiResponse) => {
    const { principal } = res.locals;
    authorize(principal, null);
    return res.status(200).json(await store.list(principal.org));
  });
  router.post("/api/v1/meetings", async (req, res: ApiResponse) => {
    const { principal } = res.locals;
    authorize(principal, null, true);
    const created = await store.create(principal.org, await jsonBody(req));
    return res.status(201).json(publicMeeting(created));
  });
  router.all("/api/v1/meetings", (req, res: ApiResponse) => {
    authorize(res.locals.principal, null, req.method !== "GET");
    fail(405, "Use GET or POST.");
  });

  router.param("id", async (req, res, next, value: string) => {
    const id = uuid.parse(value);
    const locals = res.locals as ApiLocals;
    const { principal } = locals;
    authorize(principal, id, req.method !== "GET" && req.method !== "HEAD");
    locals.meeting = await store.get(principal.org, id);
    next();
  });

  const meeting = "/api/v1/meetings/:id";
  router.get(meeting + "/recovery-key", (_req, res: ApiResponse) => {
    const { principal, meeting: m } = res.locals;
    return res.status(200).json({ key: auth.recoveryKey(principal, m.id) });
  });
  router.get([meeting, meeting + "/export"], (_req, res: ApiResponse) => {
    return res.status(200).json(publicMeeting(res.locals.meeting));
  });
  router.delete(meeting, async (_req, res: ApiResponse) => {
    const { principal, meeting: m } = res.locals;
    const id = m.id;
    await store.remove(principal.org, id);
    return res.status(200).json({ deleted: true });
  });
  router.post(meeting + "/commands", async (req, res: ApiResponse) => {
    const { principal, meeting: m } = res.locals;
    const id = m.id;
    const command = await jsonBody(req);
    if (command?.type === "decision" && command.decision?.supersedes) {
      const history = await store.list(principal.org);
      if (
        !m.series ||
        !history.some(
          (other) =>
            other.series === m.series &&
            other.id !== id &&
            other.id === command.decision.supersedes.meetingId &&
            other.decisions.some(
              (d) =>
                d.id === command.decision.supersedes.decisionId &&
                d.confirmed &&
                d.kind === "decision",
            ),
        )
      )
        fail(
          422,
          "Replaced decision must belong to another meeting in this series.",
        );
    }
    const key = req.headers["idempotency-key"]
      ? uuid.parse(req.headers["idempotency-key"])
      : undefined;
    const updated = await store.command(principal.org, id, revision(req), command, key);
    return res.status(200).json(publicMeeting(updated));
  });
  router.get(meeting + "/search", (req, res: ApiResponse) => {
    const query = new URL(req.originalUrl, "http://localhost").searchParams.get("q") || "";
    return res.status(200).json(searchTranscript(res.locals.meeting, query.slice(0, 300)));
  });
  router.post(meeting + "/ask", async (req, res: ApiResponse) => {
    const { principal, meeting: m } = res.locals;
    const id = m.id;
    rate(`${principal.org}:ask`, 20);
    const { question } = z
      .strictObject({ question: z.string().trim().min(1).max(1000) })
      .parse(await jsonBody(req));
    const result = await provider.ask(principal.org, m, question);
    if ((await store.get(principal.org, id)).revision !== m.revision)
      fail(
        409,
        "Meeting changed while answering. Ask again for current evidence.",
      );
    return res.status(200).json(result);
  });
  router.get(meeting + "/events", async (req, res: ApiResponse) => {
    const { principal, meeting: m } = res.locals;
    const id = m.id;
    const { started } = res.locals;
    let cursor = Number(
      req.headers["last-event-id"] || new URL(req.originalUrl, "http://localhost").searchParams.get("after") || 0,
    );
    if (!Number.isSafeInteger(cursor) || cursor < 0)
      fail(400, "Invalid event cursor.");
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    if (req.method === "HEAD") return res.end();
    res.write("retry: 2000\n\n");
    let stopped = false;
    res.on("close", () => {
      stopped = true;
    });
    // Bounded stream ensures session expiration is enforced without storing tokens in URLs.
    while (!stopped && Date.now() - started < 25000) {
      if (principal.exp && principal.exp <= Date.now() / 1000) break;
      const events = await store.events(principal.org, id, cursor);
      for (const event of events) {
        cursor = Number(event.seq);
        res.write(
          `id: ${cursor}\nevent: revision\ndata: ${JSON.stringify({ revision: event.revision })}\n\n`,
        );
      }
      if (!events.length) res.write(": heartbeat\n\n");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return res.end();
  });
  router.put(meeting + "/recording", async (req, res: ApiResponse) => {
    const { principal, meeting: m } = res.locals;
    const id = m.id;
    if (!objects) fail(503, "Private recording storage is not configured.");
    const rev = revision(req);
    if (rev !== m.revision)
      fail(409, "Meeting changed. Refresh before uploading.");
    const bytes = await readBody(req, 64 * 1024 * 1024);
    if (
      bytes.length < 44 ||
      bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WAVE"
    )
      fail(
        415,
        "Upload a WAV recording whose time zero matches the transcript.",
      );
    const key = `${encodeURIComponent(principal.org)}/${id}/${randomUUID()}.wav`;
    // A crash between upload and database commit leaves a durable cleanup entry.
    await store.pool.query(
      "INSERT INTO object_cleanup(key,available_at) VALUES($1,$2)",
      [key, new Date(Date.now() + 3600000)],
    );
    await objects.put(key, bytes, "audio/wav");
    try {
      const updated = await store.setRecording(principal.org, id, rev, {
        key,
        size: bytes.length,
        type: "audio/wav",
        offset: 0,
      });
      return res.status(200).json(publicMeeting(updated));
    } catch (error) {
      await store.pool.query(
        "UPDATE object_cleanup SET available_at=now() WHERE key=$1",
        [key],
      );
      throw error;
    }
  });
  router.get(meeting + "/recording", async (_req, res: ApiResponse) => {
    const { meeting: m } = res.locals;
    if (!objects || !m.recording) fail(404, "No saved recording.");
    const object = await objects.get(m.recording.key);
    if (!(object.Body instanceof Readable)) fail(502, "Recording could not be loaded.");
    res.writeHead(200, {
      "Content-Type": "audio/wav",
      ...(object.ContentLength !== undefined && { "Content-Length": object.ContentLength }),
    });
    object.Body.on("error", () => res.destroy());
    object.Body.pipe(res);
    return;
  });
  router.use(() => fail(404, "Endpoint not found."));

  return router;
}
