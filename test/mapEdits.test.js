import assert from 'node:assert/strict';
import test from 'node:test';
import { moveNode, editNode, deleteNode, subtreeIds } from '../src/shared/mapEdits.js';
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

test('refuses: moving the main idea, into its own branch, or past five levels', () => {
  assert.throws(() => moveNode(sample(), 'project', 'stack'), /main idea/);
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

test('delete removes the whole branch and its edges, but never the main idea', () => {
  const before = sample();
  const gone = subtreeIds(before, 'stack');
  const next = deleteNode(before, 'stack');
  assert.ok(next.nodes.every(n => !gone.has(n.id)));
  assert.ok(next.edges.every(e => !gone.has(e.source) && !gone.has(e.target)));
  valid(next);
  assert.throws(() => deleteNode(sample(), 'project'), /main idea/);
});
