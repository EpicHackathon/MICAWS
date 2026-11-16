import { z } from 'zod';
import { contextFields } from './contextSchema.js';

const text = z.string().refine(value => value.trim().length > 0, 'Expected nonblank text');
const node = z.strictObject({
  id: text, label: text, summary: text, importance: z.int().min(1).max(5), parentId: text.nullable(),
});
const edge = z.strictObject({ id: text, source: text, target: text });
const action = z.strictObject({ id: text, text });

const stateShape = z.strictObject({
  nodes: z.array(node), edges: z.array(edge), actionItems: z.array(action),
});

// Send only structural constraints to Gemini. Check graph invariants ourselves.
export const meetingJsonSchema = z.toJSONSchema(stateShape, { target: 'draft-7' });
delete meetingJsonSchema.$schema;

export const meetingSchema = stateShape.superRefine((state, ctx) => {
  const issue = (path, message) => ctx.addIssue({ code: 'custom', path, message });
  for (const key of ['nodes', 'edges', 'actionItems']) {
    const ids = new Set();
    state[key].forEach(({ id }, index) => {
      if (ids.has(id)) issue([key, index, 'id'], 'Duplicate ID');
      ids.add(id);
    });
  }
  const nodes = new Map(state.nodes.map(node => [node.id, node]));
  const roots = state.nodes.filter(node => node.parentId === null);
  // Before meaningful speech, the complete meeting state may be empty.
  if (state.nodes.length && !roots.length) issue(['nodes'], 'Expected at least one tree root');
  if (!state.nodes.length && state.actionItems.length) issue(['actionItems'], 'Tasks require a meeting root');

  state.nodes.forEach((node, index) => {
    if ((node.parentId === null) !== (node.importance === 5)) {
      issue(['nodes', index, 'importance'], 'Only the root must have importance 5');
    }
    const seen = new Set([node.id]);
    let current = node;
    let depth = 1;
    while (current.parentId !== null) {
      const parent = nodes.get(current.parentId);
      if (!parent) {
        issue(['nodes', index, 'parentId'], 'Unknown parent');
        break;
      }
      if (seen.has(parent.id)) {
        issue(['nodes', index, 'parentId'], 'Cycle in hierarchy');
        break;
      }
      seen.add(parent.id);
      depth += 1;
      if (depth > 5) {
        issue(['nodes', index, 'parentId'], 'Tree exceeds five levels');
        break;
      }
      current = parent;
    }
  });

  const targets = new Set();
  state.edges.forEach(({ id, source, target }, index) => {
    const child = nodes.get(target);
    if (!nodes.has(source) || !child || child.parentId !== source || source === target
        || id !== `${source}-${target}` || targets.has(target)) {
      issue(['edges', index], 'Expected one canonical parent-to-child edge');
    }
    targets.add(target);
  });
  for (const node of state.nodes) {
    if (node.parentId !== null && !targets.has(node.id)) issue(['edges'], 'Missing parent-to-child edge');
  }
});

export const requestSchema = z.strictObject({
  ...contextFields,
  newSegments: z.array(z.strictObject({
    time: z.number().nonnegative(), speaker: z.string().nullable(), text: z.string(),
  })),
  previousState: meetingSchema,
  historicalContext: z.array(z.strictObject({
    time: z.number().nonnegative(), speaker: z.string().nullable(), text: z.string(),
  })).max(16).optional(),
  reassessment: z.boolean().optional(),
  // Topics people edited by hand (renamed/moved/added). The AI must not move, rename or delete them.
  lockedIds: z.array(z.string()).optional(),
}).superRefine((request, ctx) => {
  const historyLength = (request.historicalContext || [])
    .reduce((length, segment) => length + segment.text.length, 0);
  if (historyLength > 8000) {
    ctx.addIssue({
      code: 'custom',
      path: ['historicalContext'],
      message: 'Historical context exceeds the 8000 character limit',
    });
  }
});

export const emptyMeetingState = { nodes: [], edges: [], actionItems: [] };
