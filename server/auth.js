import { createHmac, timingSafeEqual } from "node:crypto";
import { fail } from "../src/shared/savedMeeting.js";

const signature = (text, secret) =>
  createHmac("sha256", secret).update(text).digest("base64url");
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createAuth(env) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
    throw new Error(
      "SESSION_SECRET must contain at least 32 random characters.",
    );
  const credentials = JSON.parse(env.SERVICE_CREDENTIALS || "[]");
  if (
    !credentials.length ||
    credentials.some(
      (c) => !c.org || typeof c.key !== "string" || c.key.length < 32,
    )
  )
    throw new Error(
      "Configure SERVICE_CREDENTIALS with organization-scoped random keys.",
    );
  return {
    recoveryKey(principal, id) {
      authorize(principal, id, true);
      return createHmac("sha256", env.SESSION_SECRET)
        .update(JSON.stringify(["draft", principal.org, id]))
        .digest("base64");
    },
    issue(service, { meetingId = null, role = "viewer" } = {}) {
      if (!service.service)
        fail(403, "Only the partner backend can issue browser sessions.");
      if (!["viewer", "editor"].includes(role)) fail(400, "Invalid role.");
      const claims = {
        org: service.org,
        meetingId,
        role,
        exp: Math.floor(Date.now() / 1000) + 900,
        aud: "micaws-browser",
      };
      const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
      return {
        token: `${body}.${signature(body, env.SESSION_SECRET)}`,
        expiresAt: claims.exp * 1000,
      };
    },
    read(header) {
      const bearer = header?.startsWith("Bearer ") ? header.slice(7) : "";
      const service = credentials.find((c) => equal(c.key, bearer));
      if (service)
        return {
          org: service.org,
          service: true,
          role: "editor",
          meetingId: null,
        };
      const [body, sig, extra] = bearer.split(".");
      if (!body || extra || !equal(sig, signature(body, env.SESSION_SECRET)))
        fail(
          401,
          "Connect through your meeting provider or request a new session.",
        );
      let claims;
      try {
        claims = JSON.parse(Buffer.from(body, "base64url").toString());
      } catch {
        fail(401, "Invalid session.");
      }
      if (
        claims.aud !== "micaws-browser" ||
        !credentials.some((c) => c.org === claims.org) ||
        !Number.isFinite(claims.exp) ||
        claims.exp <= Date.now() / 1000 ||
        !["viewer", "editor"].includes(claims.role)
      )
        fail(
          401,
          "Your session expired. Reconnect through your meeting provider.",
        );
      return claims;
    },
  };
}
export function authorize(principal, id, write = false) {
  if (principal.meetingId && principal.meetingId !== id)
    fail(403, "This session cannot access that meeting.");
  if (write && principal.role !== "editor")
    fail(403, "This meeting is read-only.");
}
