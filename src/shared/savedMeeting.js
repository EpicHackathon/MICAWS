import { z } from "zod";
import { emptyMeetingState, meetingSchema } from "./meetingSchema.js";

export const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).refine(
  value => !["__proto__", "constructor", "prototype"].includes(value), "Reserved identifier"
);
const shortText = z.string().trim().min(1).max(2000);
export const segmentSchema = z
  .strictObject({
    id: identifier,
    revision: z.int().min(1),
    time: z.number().min(0).max(7200),
    end: z.number().min(0).max(7200),
    speaker: z.string().max(160).nullable(),
    text: shortText,
  })
  .refine((s) => s.end >= s.time, "End must follow start");
export const citationSchema = z.strictObject({
  segmentId: identifier,
  revision: z.int().min(1),
  quote: shortText,
});
export const decisionSchema = z.strictObject({
  id: identifier,
  text: shortText,
  kind: z.enum(["decision", "proposal", "question"]),
  confirmed: z.boolean(),
  resolved: z.boolean().default(false),
  supersedes: z
    .strictObject({ meetingId: z.string().uuid(), decisionId: identifier })
    .nullable(),
  citations: z.array(citationSchema).max(10),
});
export const createMeetingSchema = z.strictObject({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  series: z.string().trim().max(100).default(""),
});
export const commandSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("segments"),
    segments: z.array(segmentSchema).min(1).max(100),
  }),
  z.strictObject({ type: z.literal("edit"), state: meetingSchema }),
  z.strictObject({
    type: z.literal("metadata"),
    title: z.string().trim().min(1).max(200),
    series: z.string().trim().max(100),
    outputLanguage: z.string().max(60),
    translationLanguage: z.string().max(60),
  }),
  z.strictObject({ type: z.literal("decision"), decision: decisionSchema }),
  z.strictObject({
    type: z.literal("task"),
    id: identifier,
    status: z.enum(["open", "doing", "done"]),
  }),
  z.strictObject({
    type: z.literal("evidence"),
    target: shortText,
    citations: z.array(citationSchema).max(10),
  }),
  z.strictObject({ type: z.literal("finish") }),
  z.strictObject({ type: z.literal("reopen") }),
  z.strictObject({ type: z.literal("retry") }),
]);

export function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
export function validCitations(citations, segments) {
  return citations.every((c) =>
    segments.some(
      (s) =>
        s.id === c.segmentId &&
        s.revision === c.revision &&
        s.text.includes(c.quote),
    ),
  );
}
export function newMeeting(input) {
  return {
    ...createMeetingSchema.parse(input),
    revision: 0,
    inputVersion: 0,
    processedVersion: 0,
    status: "open",
    segments: [],
    state: structuredClone(emptyMeetingState),
    lockedIds: [],
    lockedTaskIds: [],
    deletedNodes: [],
    deletedTaskIds: [],
    evidence: {},
    lockedEvidenceTargets: [],
    summary: [],
    decisions: [],
    taskStatus: {},
    outputLanguage: "English",
    translationLanguage: "",
    translations: {},
    recording: null,
    processing: "idle",
    processingError: null,
  };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function applyCommand(current, raw) {
  const command = commandSchema.parse(raw);
  const next = structuredClone(current);
  let reprocess = false;
  switch (command.type) {
    case "segments": {
      if (next.status !== "open")
        fail(409, "Reopen the meeting before changing its transcript.");
      const byId = new Map(next.segments.map((s) => [s.id, s]));
      let corrected = false;
      for (const segment of command.segments) {
        const old = byId.get(segment.id);
        if (old && segment.revision < old.revision) continue;
        if (old && segment.revision === old.revision) {
          if (!same(segment, old))
            fail(
              409,
              "The segment revision already contains different text. Refresh before correcting it.",
            );
          continue;
        }
        byId.set(segment.id, segment);
        if (old) corrected = true;
        reprocess = true;
      }
      if (!reprocess)
        return { meeting: current, changed: false, reprocess: false };
      next.segments = [...byId.values()].sort(
        (a, b) => a.time - b.time || a.id.localeCompare(b.id),
      );
      if (
        next.segments.length > 2000 ||
        next.segments.reduce((n, s) => n + s.text.length, 0) > 200000
      )
        fail(413, "Meeting transcript limit reached. Start a new meeting.");
      // Remove stale quotes immediately, even while a provider is unavailable.
      next.evidence = Object.fromEntries(
        Object.entries(next.evidence).map(([key, refs]) => [
          key,
          refs.filter((c) => validCitations([c], next.segments)),
        ]),
      );
      if (corrected) {
        next.summary = [];
        next.decisions = next.decisions
          .filter((d) => d.confirmed)
          .map((d) => ({
            ...d,
            citations: d.citations.filter((c) =>
              validCitations([c], next.segments),
            ),
          }));
      }
      next.translations = Object.fromEntries(
        Object.entries(next.translations).filter(([id, value]) =>
          next.segments.some(
            (s) => s.id === id && s.revision === value.revision,
          ),
        ),
      );
      break;
    }
    case "edit": {
      for (const item of [...command.state.nodes, ...command.state.actionItems]) identifier.parse(item.id);
      if (
        command.state.nodes.length > 1000 ||
        command.state.actionItems.length > 500
      )
        fail(413, "Meeting map limit reached.");
      for (const [field, lockField, deletedField] of [
        ["nodes", "lockedIds", "deletedNodes"],
        ["actionItems", "lockedTaskIds", "deletedTaskIds"],
      ]) {
        const before = new Map(next.state[field].map((n) => [n.id, n]));
        const ids = new Set(command.state[field].map((n) => n.id));
        next[lockField] = [
          ...new Set([
            ...next[lockField],
            ...command.state[field]
              .filter((n) => !same(n, before.get(n.id)))
              .map((n) => n.id),
          ]),
        ].filter((id) => ids.has(id));
        const deleted = next.state[field].filter((n) => !ids.has(n.id));
        next[deletedField].push(
          ...deleted.map((n) =>
            field === "nodes"
              ? { id: n.id, label: n.label, summary: n.summary }
              : n.id,
          ),
        );
      }
      next.state = command.state;
      const targets = new Set([
        ...next.state.nodes.map((n) => `node:${n.id}`),
        ...next.state.actionItems.map((t) => `task:${t.id}`),
      ]);
      next.evidence = Object.fromEntries(
        Object.entries(next.evidence).filter(([key]) => targets.has(key)),
      );
      next.summary = [];
      reprocess = true;
      break;
    }
    case "metadata":
      Object.assign(next, {
        title: command.title,
        series: command.series,
        outputLanguage: command.outputLanguage,
        translationLanguage: command.translationLanguage,
      });
      if (next.translationLanguage !== current.translationLanguage)
        next.translations = {};
      reprocess =
        next.outputLanguage !== current.outputLanguage ||
        next.translationLanguage !== current.translationLanguage;
      break;
    case "decision":
      if (!validCitations(command.decision.citations, next.segments))
        fail(422, "Evidence changed. Select current transcript references.");
      next.decisions = [
        ...next.decisions.filter((d) => d.id !== command.decision.id),
        command.decision,
      ];
      if (next.decisions.length > 500) fail(413, "Decision limit reached.");
      break;
    case "task":
      if (!next.state.actionItems.some((t) => t.id === command.id))
        fail(404, "Task not found.");
      next.taskStatus[command.id] = command.status;
      next.lockedTaskIds = [...new Set([...next.lockedTaskIds, command.id])];
      break;
    case "evidence":
      if (
        ![
          ...next.state.nodes.map((n) => `node:${n.id}`),
          ...next.state.actionItems.map((t) => `task:${t.id}`),
        ].includes(command.target)
      )
        fail(404, "Evidence target not found.");
      if (!validCitations(command.citations, next.segments))
        fail(422, "Evidence no longer matches the transcript.");
      next.evidence[command.target] = command.citations;
      next.lockedEvidenceTargets = [
        ...new Set([...(next.lockedEvidenceTargets || []), command.target]),
      ];
      break;
    case "finish":
      next.status = "finished";
      reprocess = true;
      break;
    case "reopen":
      next.status = "open";
      break;
    case "retry":
      reprocess = true;
      break;
  }
  if (same(current, next) && !reprocess)
    return { meeting: current, changed: false, reprocess: false };
  if (reprocess) {
    next.inputVersion += 1;
    next.processing = "queued";
    next.processingError = null;
  }
  next.revision += 1;
  return { meeting: next, changed: true, reprocess };
}

export function searchTranscript(meeting, query) {
  const words = query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];
  if (!words.length) return [];
  return meeting.segments
    .map((s) => ({
      ...s,
      score: words.filter((w) => s.text.toLocaleLowerCase().includes(w)).length,
    }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.time - b.time)
    .slice(0, 20);
}
