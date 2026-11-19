import assert from 'node:assert/strict';
import test from 'node:test';
import { addNode, moveNode, deleteNode } from '../src/shared/mapEdits.js';
import { emptyMeetingState, meetingSchema } from '../src/shared/meetingSchema.js';
import { arrangeForest } from '../src/shared/forestLayout.js';
import { createHandler, preservesPrevious, mapCheck, restoreKeptTasks } from '../api/process.js';
import { getDemoState } from '../src/shared/demo.js';

const node = (id, parentId = null) => ({ id, parentId, label: id, summary: id, importance: parentId === null ? 5 : 3 });
const forest = { nodes: [node('launch'), node('hiring'), node('budget', 'launch')], edges: [{id: 'launch-budget', source: 'launch', target: 'budget'}], actionItems: [] };
test('forest schema accepts separate trees and rejects edges between roots or cycles', () => {
  assert.equal(meetingSchema.safeParse(forest).success, true);
  assert.equal(mapCheck(forest).treeCount, 2);
  assert.equal(meetingSchema.safeParse({ ...forest, edges: [...forest.edges, { id: 'launch-hiring', source: 'launch', target: 'hiring' }] }).success, false);
  const merged = moveNode(forest, 'hiring', 'budget');
  assert.equal(meetingSchema.safeParse(merged).success, true);
  assert.equal(merged.nodes.find(n => n.id === 'hiring').importance, 4);
  assert.throws(() => moveNode(merged, 'launch', 'hiring'), /own branch/);
});
test('users can create, split, merge and delete trees without changing retained IDs', () => {
  const first = addNode(emptyMeetingState, null, { label: 'Plan' });
  const second = addNode(first, null, { label: 'Hiring' });
  const ids = second.nodes.map(n => n.id);
  const merged = moveNode(second, ids[1], ids[0]);
  const split = moveNode(merged, ids[1], null);
  assert.deepEqual(split.nodes.map(n => n.id), ids);
  assert.equal(meetingSchema.safeParse(split).success, true);
  assert.equal(deleteNode(split, ids[0]).nodes.length, 1);
});
test('large translated rectangles and independent trees do not overlap', () => {
  const size = new Map(['a','b','c'].map(id => [id, { width: 300, height: 400 }]));
  const result = arrangeForest([new Map([['a', { x: 0, y: 0 }], ['b', { x: 0, y: 30 }]]), new Map([['c', { x: -100, y: 0 }]])], size);
  assert.ok(result.get('b').y >= result.get('a').y + 400);
  assert.ok(result.get('c').x >= result.get('a').x + 300);
});
test('reassessment can remove obsolete AI tasks, but preserves locked tasks and deletion intent', () => {
  const previous = { ...forest, actionItems: [{ id: 'task', text: 'Old task' }] };
  assert.equal(preservesPrevious(forest, previous, [], { reassessment: true }), true);
  assert.equal(preservesPrevious(forest, previous, [], { reassessment: true, lockedTaskIds: ['task'] }), false);
  assert.equal(preservesPrevious(forest, emptyMeetingState, [], { deletedNodes: [{id: 'launch', label: 'launch'}] }), false);
  assert.equal(preservesPrevious({ ...forest, nodes: [...forest.nodes, node('new-id')] }, forest, [], {deletedNodes: [{id: 'old-id', label: 'new-id'}]}), false);
});
test('document removal updates mocked forest and does not invent tasks', () => {
  const materials = [{id: 'doc', name: 'Background', pages: [{page: 1, text: 'Possible launch ideas.'}]}];
  const state = getDemoState([], emptyMeetingState, { materials });
  assert.equal(state.nodes.length, 1);
  assert.deepEqual(state.actionItems, []);
  assert.deepEqual(getDemoState([], state, { materials: [] }), emptyMeetingState);
});
test('provider receives document, language and manual deletion context during reassessment', async () => {
  let received;
  const handler = createHandler({ env: { GEMINI_API_KEY: 'test' }, generateText: async input => {
    received = input; return JSON.stringify(forest);
  }});
  const response = await handler(new Request('http://localhost/api/process', { method: 'POST', body: JSON.stringify({
    previousState: forest, newSegments: [], reassessment: true, outputLanguage: 'Spanish',
    deletedNodes: [{ id: 'gone', label: 'Gone', summary: 'Removed' }], materials: [],
  }) }));
  assert.equal(response.status, 200);
  assert.equal(received.outputLanguage, 'Spanish');
  assert.equal(received.deletedNodes[0].id, 'gone');
});

test('a reworded or dropped task is put back instead of failing the whole update', () => {
  const previous = [{ id: 'a', text: 'Read chapter 1' }, { id: 'b', text: 'Study for quiz' }];
  const next = [{ id: 'a', text: 'Read chapter one and annotate' }, { id: 'c', text: 'Bring books' }];
  assert.deepEqual(restoreKeptTasks(next, previous), [...previous, { id: 'c', text: 'Bring books' }]);
  assert.deepEqual(restoreKeptTasks(next, previous, { deletedTaskIds: ['b'] }), [previous[0], { id: 'c', text: 'Bring books' }]);
  // On reassessment only locked tasks are forced back; the AI may update the rest.
  assert.deepEqual(restoreKeptTasks(next, previous, { reassessment: true, lockedTaskIds: ['b'] }), [previous[1], ...next]);
});
