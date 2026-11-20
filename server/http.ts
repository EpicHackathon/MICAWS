import express, { type ErrorRequestHandler, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { fail } from "../src/shared/savedMeeting.js";
import type { createAuth } from "./auth.js";
import { createLiveRouter } from "./live.js";
import { createSavedRouter, type SavedApiDependencies } from "./saved.js";

export function createApp({
  store,
  auth,
  provider,
  objects,
  env,
  staticDir = "dist",
  demoSession,
}: SavedApiDependencies & {
  env: NodeJS.ProcessEnv;
  staticDir?: string;
  demoSession?: () => ReturnType<ReturnType<typeof createAuth>["issue"]>;
}) {
  const origins = (env.EMBED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const origin of origins)
    if (new URL(origin).origin !== origin)
      throw new Error(
        "EMBED_ORIGINS must contain exact origins, without paths.",
      );
  const root = resolve(staticDir);
  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  app.enable("case sensitive routing");
  app.enable("strict routing");

  app.use((req, res, next) => {
    const requestId = randomUUID();
    const started = Date.now();
    res.locals.requestId = requestId;
    res.locals.started = started;
    // Deliberately omit URL queries, credentials, payloads, and exception strings.
    res.once("close", () => {
      console.info(JSON.stringify({
        requestId,
        method: req.method,
        status: res.statusCode,
        durationMs: Date.now() - started,
      }));
    });
    res.setHeader("X-Request-ID", requestId);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; frame-ancestors 'self' ${origins.join(" ")}; base-uri 'none'; form-action 'self'`,
    );
    if (req.headers.origin && req.headers.origin !== env.APP_ORIGIN) {
      if (!origins.includes(req.headers.origin))
        fail(403, "Origin is not allowed.");
      res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Methods": "GET,POST,DELETE,PUT,OPTIONS",
        "Access-Control-Allow-Headers":
          "Authorization,Content-Type,If-Match,Last-Event-ID,Idempotency-Key",
      });
      return res.end();
    }
    next();
  });

  app.get("/health", (_req, res) => res.status(200).json({ status: "alive" }));
  app.get("/ready", async (_req, res) => {
    await store.pool.query("SELECT 1");
    return res.status(200).json({ status: "ready" });
  });
  app.get("/api/v1/config", (_req, res) => {
    return res.status(200).json({
      brand: (env.BRAND_NAME || "MICAWS").slice(0, 80),
      embedOrigins: origins,
      provider: env.AI_PROVIDER,
      recordings: !!objects,
      demo: env.SAVED_DEMO === "true",
    });
  });

  const liveEnabled = env.ENABLE_LIVE_WORKSPACE === "true";
  if (liveEnabled) app.use(createLiveRouter(env, env.APP_ORIGIN));

  if (demoSession) {
    app.get("/api/v1/demo-session", (_req, res) => res.json(demoSession()));
  }

  const frontendMissing = () => Object.assign(
    new Error("Not found. Build the frontend first."), { status: 404 },
  );
  function serveWorkspace(_req: Request, res: Response, next: (error?: unknown) => void) {
    res.sendFile("index.html", { root, cacheControl: false, lastModified: false }, (error) => {
      if (error) next("code" in error && error.code === "ENOENT" ? frontendMissing() : error);
    });
  }
  app.get("/", (req, res, next) => {
    if (liveEnabled) return serveWorkspace(req, res, next);
    res.redirect("/workspace");
  });
  app.get("/workspace", serveWorkspace);

  const assets = express.static(root, {
    index: false, redirect: false, cacheControl: false, etag: false, lastModified: false,
  });
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    if (req.method !== "GET" && req.method !== "HEAD") fail(405, "Use GET.");
    assets(req, res, (error) => {
      if (error) return next(error);
      next(frontendMissing());
    });
  });

  app.use(createSavedRouter({ store, auth, provider, objects }));

  const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (res.headersSent) {
      res.end();
      return;
    }
    const status = error instanceof z.ZodError ? 400 : (error as { status?: number } | null)?.status || 500;
    res.status(status).json({
      error:
        status === 500
          ? "Server unavailable. Your saved input is retained."
          : error instanceof Error ? error.message : String(error),
      requestId: res.locals.requestId,
    });
  };
  app.use(handleError);
  return app;
}
