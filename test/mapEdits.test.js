import assert from 'node:assert/strict';
import test from 'node:test';
import { moveNode, editNode, deleteNode, subtreeIds, moveOut, addNode } from '../src/shared/mapEdits.js';
import { meetingSchema } from '../src/shared/meetingSchema.js';
import { mockMeeting } from '../src/shared/mockMeeting.js';

const sample = () => structuredClone(mockMeeting);
const valid = state => assert.equal(meetingSchema.safeParse(state).success, true, JSON.stringify(meetingSchema.safeParse(state).error?.issues));

test('move a detail under another main point keeps a valid tree', () => {
  const next = moveNode(sample(), 'stack-react', 'roles');
  assert.equal(next.nodes.find(n => n.id === 'stack-react').parentId, 'roles');
  assert.ok(next.edges.some(e => e.id === 'roles-stack-react'));
  assert.ok(!next.edges.some(e => e.target === 'stack-react' && e.source === 'stack'));
  valid(next);
});

test('moving a branch moves everything under it', () => {
  const next = moveNode(sample(), 'stack-openai', 'timeline');   // openai has 2 sub-details
  valid(next);
  assert.equal(next.nodes.find(n => n.id === 'openai-gpt').parentId, 'stack-openai');
});

test('refuses moving any node into its own branch or past five levels', () => {
  assert.throws(() => moveNode(sample(), 'project', 'stack'), /own branch/);
  assert.throws(() => moveNode(sample(), 'stack', 'stack-openai'), /own branch/);
  // rikki-shapes is level 4 (other branch); stack is 3 levels tall (stack > openai > gpt) -> 7
  assert.throws(() => moveNode(sample(), 'stack', 'rikki-shapes'), /deeper than 5/);
});

test('edit title and summary, refusing empty text', () => {
  const next = editNode(sample(), 'quiz', { label: '  Quiz Prep ', summary: 'Study Sunday.' });
  const quiz = next.nodes.find(n => n.id === 'quiz');
  assert.equal(quiz.label, 'Quiz Prep');
  assert.equal(quiz.summary, 'Study Sunday.');
  valid(next);
  assert.throws(() => editNode(sample(), 'quiz', { label: '   ' }), /title/);
});

test('delete removes the whole branch and permits deleting a complete tree', () => {
  const before = sample();
  const gone = subtreeIds(before, 'stack');
  const next = deleteNode(before, 'stack');
  assert.ok(next.nodes.every(n => !gone.has(n.id)));
  assert.ok(next.edges.every(e => !gone.has(e.source) && !gone.has(e.target)));
  valid(next);
  assert.deepEqual(deleteNode(sample(), 'project'), { nodes: [], edges: [], actionItems: [] });
});

test('move out: a detail becomes a main point; a main point becomes a new tree', () => {
  const next = moveOut(sample(), 'stack-react');          // detail under Tech Stack
  assert.equal(next.nodes.find(n => n.id === 'stack-react').parentId, 'project');
  valid(next);
  const forest = moveOut(sample(), 'stack');
  assert.equal(forest.nodes.find(n => n.id === 'stack').parentId, null);
  valid(forest);
});

test('add a topic with just a title (summary defaults to the title)', () => {
  const next = addNode(sample(), 'timeline', { label: 'Judging at 1 PM' });
  const added = next.nodes.find(n => n.label === 'Judging at 1 PM');
  assert.equal(added.parentId, 'timeline');
  assert.equal(added.summary, 'Judging at 1 PM');
  assert.equal(added.importance, 2);
  valid(next);
  const point = addNode(sample(), 'project', { label: 'Budget', summary: 'No budget needed.' }).nodes.find(n => n.label === 'Budget');
  assert.equal(point.importance, 4);
  assert.throws(() => addNode(sample(), 'timeline', { label: '  ' }), /title/);
  assert.throws(() => addNode(sample(), 'nope', { label: 'y' }), /no longer exists/);
});
