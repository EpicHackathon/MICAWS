import { z } from 'zod';

const text = z.string().refine(value => value.trim().length > 0, 'Expected nonblank text');
const node = z.strictObject({
  id: text, label: text, summary: text, importance: z.int().min(1).max(5),
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
  const nodeIds = new Set(state.nodes.map(({ id }) => id));
  const relationships = new Set();
  state.edges.forEach(({ source, target }, index) => {
    if (!nodeIds.has(source) || !nodeIds.has(target)) {
      issue(['edges', index], 'Unknown node reference');
    }
    const pair = JSON.stringify([source, target].sort());
    if (source === target || relationships.has(pair)) {
      issue(['edges', index], 'Self-loop or duplicate relationship');
    }
    relationships.add(pair);
  });
});

export const requestSchema = z.strictObject({
  newSegments: z.array(z.strictObject({
    time: z.number().nonnegative(), speaker: z.string().nullable(), text: z.string(),
  })),
  previousState: meetingSchema,
});

export const emptyMeetingState = { nodes: [], edges: [], actionItems: [] };
