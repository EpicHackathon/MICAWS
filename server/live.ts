import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { createHandler } from "../api/process.js";
import { createSummaryHandler } from "../api/summary.js";
import { createTranslationHandler } from "../api/translate.js";

const unavailable =
  "The transcription server is unavailable or still loading. Start the Python server on port 8000 and wait for Application startup complete, then retry.";

async function sendResponse(res: Response, response: globalThis.Response) {
  const body = await response.text();
  const contentType = response.headers.get("content-type");
  const allow = response.headers.get("allow");
  if (contentType) res.set("Content-Type", contentType);
  if (allow) res.set("Allow", allow);
  res.status(response.status).send(body);
}

function requestBody(req: Request) {
  return Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : undefined;
}

export function createLiveRouter(env: NodeJS.ProcessEnv, allowedOrigin?: string) {
  const router = express.Router({ caseSensitive: true, strict: true });
  const parseBody = express.raw({ type: () => true, limit: "8mb", inflate: false });
  const aiEnv = env.AI_PROVIDER === "mock" ? { ...env, MEETING_MOCK: "true" } : env;
  const handlers = {
    "/api/process": createHandler({ env: aiEnv }),
    "/api/summary": createSummaryHandler({ env: aiEnv }),
    "/api/translate": createTranslationHandler({ env: aiEnv }),
  };
  const target = new URL(env.TRANSCRIPTION_URL || "http://127.0.0.1:8000");
  if (!["http:", "https:"].includes(target.protocol))
    throw new Error("TRANSCRIPTION_URL must use HTTP or HTTPS.");

  function checkOrigin(req: Request, res: Response, next: () => void) {
    if (allowedOrigin && req.headers.origin && req.headers.origin !== allowedOrigin) {
      res.status(403).json({ error: "Origin is not allowed." });
      return;
    }
    next();
  }

  for (const [path, handle] of Object.entries(handlers)) {
    router.all(path, checkOrigin, parseBody, async (req, res) => {
      const request = new Request("http://localhost" + path, {
        method: req.method,
        body: req.method === "POST" ? requestBody(req) : undefined,
        headers: { "Content-Type": req.get("content-type") || "application/json" },
      });
      await sendResponse(res, await handle(request));
    });
  }

  const proxyTranscription = async (req: Request, res: Response) => {
    const contentType = req.get("content-type");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.once("close", cancel);
    try {
      const url = new URL(target);
      url.pathname = target.pathname.replace(/\/$/, "") + req.path;
      url.search = new URL(req.originalUrl, "http://localhost").search;
      const upstream = await fetch(url, {
        method: req.method,
        headers: contentType ? { "Content-Type": contentType } : {},
        body: req.method === "POST" ? requestBody(req) : undefined,
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
        redirect: "error",
      });
      await sendResponse(res, upstream);
    } catch {
      if (!res.destroyed) res.status(503).json({ detail: unavailable });
    } finally {
      res.off("close", cancel);
    }
  };
  router.post("/api/transcribe", checkOrigin, parseBody, proxyTranscription);
  router.get("/api/transcribe/health", checkOrigin, proxyTranscription);
  router.all("/api/transcribe", (_req, res) =>
    res.set("Allow", "POST").status(405).json({ detail: "Use POST." }),
  );

  const handleError: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status === 413 ? 413 : error.status === 415 ? 415 : 500;
    const message = {
      413: "Live request exceeds the 8 MB limit.",
      415: "Compressed request bodies are unsupported.",
      500: "Live processing server failed.",
    }[status];
    res.status(status).json({ error: message, detail: message });
  };
  router.use(handleError);
  return router;
}
