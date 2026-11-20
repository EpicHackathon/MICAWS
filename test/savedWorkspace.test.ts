import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createServer } from "vite";
import { newMeeting, applyCommand } from "../src/shared/savedMeeting.js";

test("saved workspace autosaves corrections and recovers an uncertain response after remount", async (t) => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "http://localhost/workspace",
  });
  const originals = new Map();
  function expose(key, value) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  }
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "SVGElement",
    "Node",
    "MutationObserver",
    "localStorage",
    "sessionStorage",
    "FormData",
  ])
    expose(key, dom.window[key]);
  expose("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  expose(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  expose("requestAnimationFrame", (fn) => setTimeout(fn, 0));
  expose("cancelAnimationFrame", clearTimeout);
  expose("IS_REACT_ACT_ENVIRONMENT", true);
  let m = newMeeting({
    id: randomUUID(),
    title: "Saved review",
    series: "Pilot",
  });
  m = applyCommand(m, {
    type: "segments",
    segments: [
      {
        id: "line",
        revision: 1,
        time: 0,
        end: 5,
        speaker: "Alex",
        text: "We launch Friday.",
      },
    ],
  }).meeting;
  let loseResponse = true;
  let attempts = 0;
  let reads = 0;
  let eventStream;
  let eventId = 0;
  let deferRead;
  function notify(revision) {
    eventStream.enqueue(new TextEncoder().encode(
      `id: ${++eventId}\nevent: revision\ndata: ${JSON.stringify({ revision })}\n\n`,
    ));
  }
  const receipts = new Set();
  t.mock.method(globalThis, "fetch", async (url, options = {}) => {
    if (url.endsWith("/config"))
      return Response.json({
        brand: "Pilot",
        embedOrigins: [],
        provider: "mock",
        demo: true,
      });
    if (url.endsWith("/demo-session"))
      return Response.json({ token: "synthetic-browser-session" });
    if (url.endsWith("/session"))
      return Response.json({ org: "test", role: "editor", meetingId: m.id });
    if (url.endsWith("/recovery-key"))
      return Response.json({ key: Buffer.alloc(32, 7).toString("base64") });
    if (url.includes("/events?"))
      return new Response(
        new ReadableStream({
          start(controller) {
            eventStream = controller;
            controller.enqueue(new TextEncoder().encode(": heartbeat\n\n"));
            options.signal.addEventListener(
              "abort",
              () => controller.error(new Error("aborted")),
              { once: true },
            );
          },
        }),
      );
    if (url.endsWith("/commands")) {
      attempts++;
      const key = options.headers["Idempotency-Key"];
      if (!receipts.has(key)) {
        m = applyCommand(m, JSON.parse(options.body)).meeting;
        receipts.add(key);
      }
      if (loseResponse) {
        loseResponse = false;
        throw new Error("Connection interrupted after save");
      }
      return Response.json(m);
    }
    if (url.endsWith(m.id)) {
      reads++;
      if (deferRead) await deferRead;
      return Response.json(m);
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const vite = await createServer({
    server: { middlewareMode: true, ws: false },
    appType: "custom",
  });
  const { createRoot } = await import("react-dom/client");
  const { default: Workspace } = await vite.ssrLoadModule(
    "/src/components/SavedWorkspace.tsx",
  );
  let root = createRoot(document.getElementById("root"));
  t.after(async () => {
    await act(async () => root.unmount());
    await vite.close();
    dom.window.close();
    for (const [key, descriptor] of originals)
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
  });
  const button = (text) =>
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent === text,
    );
  async function waitFor(predicate) {
    const deadline = Date.now() + 5000;
    while (!predicate() && Date.now() < deadline) {
      await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
    }
    assert.ok(predicate(), "Expected UI state before timeout");
  }
  async function connect() {
    await act(async () => {
      root.render(React.createElement(Workspace));
    });
    await waitFor(() => button("Open sample workspace"));
    await act(async () => button("Open sample workspace").click());
    await waitFor(() => document.querySelector(".transcript-correction textarea"));
  }
  await act(async () => root.render(React.createElement(Workspace)));
  assert.equal(document.querySelector('.workspace-help a[href="#help-settings"]'), null,
    'No broken settings link before opening a meeting');
  await connect();
  await waitFor(() => document.querySelector('.workspace-help a[href="#help-settings"]'));
  await act(async () => document.querySelector('.workspace-help a[href="#help-settings"]').click());
  assert.equal(document.getElementById('help-settings').open, true);
  assert.equal(document.activeElement.id, 'help-settings');
  await act(async () => document.querySelector('.workspace-help a[href="#help-corrections"]').click());
  assert.equal(document.querySelector('#help-corrections details').open, true);
  assert.equal(attempts, 0, 'Help navigation does not save or submit forms');
  assert.match(document.body.textContent, /Saved review/);
  await waitFor(() => eventStream);
  const initialReads = reads;
  await act(async () => {
    notify(m.revision - 1);
    notify(m.revision);
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  assert.equal(reads, initialReads, "Replay of known revisions needs no meeting reads");

  let releaseRead;
  deferRead = new Promise(resolve => { releaseRead = resolve; });
  await act(async () => notify(m.revision + 1));
  await waitFor(() => reads === initialReads + 1);
  await act(async () => {
    notify(m.revision + 2);
    notify(m.revision + 3);
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  assert.equal(reads, initialReads + 1, "New revisions share the in-flight read");
  m = { ...m, revision: m.revision + 3, title: "Updated saved review" };
  await act(async () => {
    deferRead = undefined;
    releaseRead();
    await new Promise(resolve => setTimeout(resolve, 30));
  });
  await waitFor(() => document.body.textContent.includes("Updated saved review"));
  assert.equal(reads, initialReads + 1, "A current response satisfies the whole burst");
  const beforeNextUpdate = reads;
  await act(async () => notify(m.revision + 1));
  await waitFor(() => reads === beforeNextUpdate + 1);
  m = { ...m, revision: m.revision + 1, title: "Caught up saved review" };
  await waitFor(() => document.body.textContent.includes("Caught up saved review"));
  assert.equal(reads, beforeNextUpdate + 2, "An older response leaves one refresh pending");


  const correction = document.querySelector(".transcript-correction textarea");
  assert.ok(correction);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLTextAreaElement.prototype,
      "value",
    ).set.call(correction, "We launch Monday.");
    correction.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 1200)));
  assert.match(document.body.textContent, /Connection interrupted/);
  assert.equal(m.segments[0].revision, 2);
  assert.ok(localStorage.getItem(`micaws-draft:${m.id}`));
  await act(async () => root.unmount());
  root = createRoot(document.getElementById("root"));
  await connect();
  await waitFor(() => button("Retry retained change"));
  await act(async () => button("Retry retained change").click());
  assert.equal(attempts, 2);
  assert.equal(m.segments[0].revision, 2);
  assert.equal(localStorage.getItem(`micaws-draft:${m.id}`), null);
  assert.match(document.body.textContent, /Saved · revision/);
});
