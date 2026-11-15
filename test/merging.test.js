import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandler, preservesPrevious } from '../api/process.js';
import { meetingSchema } from '../src/shared/meetingSchema.js';
import { formatTime } from '../src/shared/formatTime.js';
import { createSummaryHandler, mockSummary } from '../api/summary.js';

// A small map: main idea "plan" with two overlapping main points (layout + placement) and a task.
const node = (id, label, parentId, importance = 3) => ({ id, label, summary: label + ' was discussed.', importance, parentId });
const edgesFor = nodes => nodes.filter(n => n.parentId).map(n => ({ id: `${n.parentId}-${n.id}`, source: n.parentId, target: n.id }));
const build = nodes => ({ nodes, edges: edgesFor(nodes), actionItems: [{ id: 't1', text: 'Sam drafts the layout.' }] });
const previous = build([
  node('plan', 'Website Plan', null, 5),
  node('layout', 'Layout', 'plan', 4),
  node('placement', 'Right Side Placement', 'plan', 4),
  node('size', 'Size Limits', 'placement'),
  node('colors', 'Colors', 'plan', 4),
  node('palette', 'Sepia Palette', 'colors'),
]);
// The AI merges "Right Side Placement" into "Layout": its child moves over, the duplicate is removed.
const merged = build([
  { ...node('plan', 'Website Plan', null, 5) },
  { ...node('layout', 'Layout', 'plan', 4), summary: 'Layout: the panel goes on the right side, with size limits.' },
  node('size', 'Size Limits', 'layout'),
  node('colors', 'Colors', 'plan', 4),
  node('palette', 'Sepia Palette', 'colors'),
]);

const ask = (answer, lockedIds) => createHandler({
  env: { GEMINI_API_KEY: 'test-only' }, generateText: async () => JSON.stringify(answer),
})(new Request('http://localhost/api/process', {
  method: 'POST',
  body: JSON.stringify({
    newSegments: [{ time: 3, speaker: null, text: 'The panel goes on the right.' }],
    previousState: previous, ...(lockedIds ? { lockedIds } : {}),
  }),
}));

test('the AI may merge two similar topics it made (child moves, duplicate removed)', async () => {
  assert.equal(meetingSchema.safeParse(merged).success, true);
  const response = await ask(merged);
  assert.equal(response.status, 200);
  const next = await response.json();
  assert.equal(next.nodes.some(n => n.id === 'placement'), false);
  assert.equal(next.nodes.find(n => n.id === 'size').parentId, 'layout');
});

test('merging is refused when it removes or moves a topic a person edited', async () => {
  assert.equal((await ask(merged, ['placement'])).status, 502);   // placement was hand-edited
  assert.equal((await ask(merged, ['size'])).status, 502);        // size was hand-placed
  assert.equal((await ask(merged, ['layout'])).status, 200);      // merging INTO a locked topic is fine
});

test('topics with user- ids are always kept in place', () => {
  const withUser = build([...previous.nodes, node('user-1', 'My Note', 'colors', 2)]);
  const movedUser = build([...previous.nodes, node('user-1', 'My Note', 'layout', 2)]);
  const droppedUser = build(previous.nodes);
  assert.equal(preservesPrevious(withUser, withUser), true);
  assert.equal(preservesPrevious(movedUser, withUser), false);
  assert.equal(preservesPrevious(droppedUser, withUser), false);
});

test('the main idea, tasks and most of the map must survive an update', () => {
  const newRoot = build(merged.nodes.map(n => n.id === 'plan' ? { ...n, id: 'plan2' }
    : n.parentId === 'plan' ? { ...n, parentId: 'plan2' } : n));
  assert.equal(preservesPrevious(newRoot, previous), false);
  assert.equal(preservesPrevious({ ...merged, actionItems: [] }, previous), false);
  const wiped = build(previous.nodes.slice(0, 3).map(n => n.id === 'placement' ? { ...n } : n));
  assert.equal(preservesPrevious(wiped, previous), false);   // 6 topics -> 3 is too many lost at once
});

test('transcript times show as minutes:seconds', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(12.4), '0:12');
  assert.equal(formatTime(72.9), '1:12');
  assert.equal(formatTime(600), '10:00');
  assert.equal(formatTime(3725), '1:02:05');
});

test('summary endpoint: mock summary from the map, real AI answer validated', async () => {
  const request = body => new Request('http://localhost/api/summary', { method: 'POST', body: JSON.stringify(body) });
  const segments = [{ time: 0, speaker: null, text: 'We planned the website.' }];
  const mock = createSummaryHandler({ env: { MEETING_MOCK: 'true' } });
  const mocked = await (await mock(request({ segments, state: previous }))).json();
  assert.deepEqual(mocked, mockSummary(previous));
  assert.match(mocked.overview, /Website Plan/);
  assert.equal(mocked.keyPoints.length, 3);
  assert.deepEqual(mocked.nextTime, ['Check on: Sam drafts the layout.']);

  const good = { overview: 'The team planned the website layout and colors.', keyPoints: ['The panel goes on the right.'], nextTime: ['Decide the button color.'] };
  const ai = answer => createSummaryHandler({ env: { GEMINI_API_KEY: 'k' }, generateText: async () => answer });
  assert.deepEqual(await (await ai(JSON.stringify(good))(request({ segments, state: previous }))).json(), good);
  assert.equal((await ai('not json')(request({ segments, state: previous }))).status, 502);
  assert.equal((await ai(JSON.stringify({ overview: '' , keyPoints: [], nextTime: [] }))(request({ segments, state: previous }))).status, 502);
  assert.equal((await ai(JSON.stringify({ overview: 'x', keyPoints: [] }))(request({ segments, state: previous }))).status, 502);   // nextTime missing
  assert.equal((await ai(JSON.stringify(good))(request({ segments: 'x', state: previous }))).status, 400);
});
