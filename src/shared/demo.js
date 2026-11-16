import { rebuildEdges } from './mapEdits.js';
const segment = (time, speaker, text) => ({ time, speaker, text });

export const demoBatches = [
  [
    segment(1, 'Alex', 'We agreed to launch the product on June 12.'),
    segment(8, 'Priya', 'I will draft the launch checklist.'),
    segment(14, null, 'I forgot my coffee.'),
  ],
  [
    segment(23, 'Alex', 'June 12 is now a beta launch for invited customers only.'),
    segment(29, 'Sam', 'We chose Instagram for beta outreach. I will draft the campaign.'),
  ],
  [
    segment(45, 'Priya', 'For the beta launch, we agreed to limit invitations to 50 customers.'),
    segment(51, 'Sam', 'I will draft the Instagram campaign as agreed.'),
  ],
];

const launch = summary => ({ id: 'launch', label: 'Product Launch', summary, importance: 5, parentId: null });
const launchTask = { id: 'checklist', text: 'Priya will draft the launch checklist.' };
const marketing = {
  id: 'marketing', label: 'Instagram Outreach', summary: 'Instagram will be used for beta outreach.',
  importance: 4, parentId: 'launch',
};
const relationship = { id: 'launch-marketing', source: 'launch', target: 'marketing' };
const marketingTask = { id: 'campaign', text: 'Sam will draft the Instagram campaign.' };

export const demoStates = [
  { nodes: [launch('The team agreed to launch on June 12.')], edges: [], actionItems: [launchTask] },
  {
    nodes: [launch('The June 12 launch is an invite-only beta.'), marketing],
    edges: [relationship], actionItems: [launchTask, marketingTask],
  },
  {
    nodes: [launch('The June 12 invite-only beta is limited to 50 customers.'), marketing],
    edges: [relationship], actionItems: [launchTask, marketingTask],
  },
];

function getBaseDemoState(segments, previousState) {
  // Cumulative matching also works if the user queues multiple batches before a request.
  const latest = demoBatches.findLastIndex(batch => batch.some(example =>
    segments.some(segment => example.time === segment.time && example.text === segment.text),
  ));
  if (latest < 0 || previousState.nodes.some(node => node.parentId === null && node.id !== 'launch')) {
    return quoteMockInput(segments, previousState);
  }

  // Replayed sample batches must not roll an already completed demo backward.
  const completed = demoStates.findLastIndex(state =>
    state.nodes.every(node => previousState.nodes.some(existing =>
      existing.id === node.id && existing.summary === node.summary)),
  );
  const sample = demoStates[Math.max(latest, completed)];
  const merge = (existing, incoming, update) => {
    const items = new Map(existing.map(item => [item.id, item]));
    for (const item of incoming) {
      if (update || !items.has(item.id)) items.set(item.id, item);
    }
    return [...items.values()];
  };
  const remaining = segments.filter(segment => !demoBatches.flat().some(example =>
    example.time === segment.time && example.text === segment.text));
  return quoteMockInput(remaining, {
    nodes: merge(previousState.nodes, sample.nodes, true),
    edges: merge(previousState.edges, sample.edges, false),
    actionItems: merge(previousState.actionItems, sample.actionItems, false),
  });
}

// Arbitrary mock input is quoted verbatim, without inferred topics or tasks.
function quoteMockInput(segments, previousState) {
  const state = structuredClone(previousState);
  const texts = segments.map(segment => segment.text.trim()).filter(Boolean);
  if (!texts.length) return state;
  if (!state.nodes.length) {
    state.nodes.push({
      id: 'mock-meeting', parentId: null, label: 'Mock Meeting',
      summary: 'Quoted test input supplied to the mock processor.', importance: 5,
    });
  }
  const root = state.nodes.find(node => node.parentId === null);
  const ids = new Set(state.nodes.map(node => node.id));
  const edgeIds = new Set(state.edges.map(edge => edge.id));
  for (const text of texts) {
    if (state.nodes.some(node => node.summary === text)) continue;
    let number = state.nodes.length;
    while (ids.has('mock-note-' + number) || edgeIds.has(root.id + '-mock-note-' + number)) number++;
    const id = 'mock-note-' + number;
    state.nodes.push({ id, parentId: root.id, label: 'Quoted Test Input', summary: text, importance: 3 });
    state.edges.push({ id: root.id + '-' + id, source: root.id, target: id });
    ids.add(id);
    edgeIds.add(root.id + '-' + id);
  }
  return state;
}

// Mock mode quotes document evidence without claiming that background facts are decisions.
export function getDemoState(segments, previousState, context = {}) {
  const state = getBaseDemoState(segments, previousState);
  const deleted = new Set((context.deletedNodes || []).map(node => node.id));
  const labels = new Set((context.deletedNodes || []).map(node => node.label.trim().toLowerCase()));
  const selected = new Set((context.materials || []).map(doc => 'material-' + doc.id));
  const generatedMaterialIds = new Set(state.nodes.filter(node => node.id.startsWith('material-') && !selected.has(node.id)).map(node => node.id));
  let nodes = state.nodes.filter(node => !deleted.has(node.id) && !generatedMaterialIds.has(node.id)
    && (node.id.startsWith('user-') || !labels.has(node.label.trim().toLowerCase())));
  for (const doc of context.materials || []) {
    const id = 'material-' + doc.id;
    if (!deleted.has(id) && !nodes.some(node => node.id === id) && !labels.has(doc.name.trim().toLowerCase())) {
      nodes.push({ id, parentId: null, label: doc.name, importance: 5,
        summary: 'Background material: ' + doc.pages.map(page => 'Page/slide ' + page.page + ': ' + page.text).join(' ').slice(0, 3000) });
    }
  }
  let count;
  do { count = nodes.length; const ids = new Set(nodes.map(node => node.id)); nodes = nodes.filter(node => node.parentId === null || ids.has(node.parentId)); } while (nodes.length !== count);
  return { nodes, edges: rebuildEdges(nodes), actionItems: nodes.length ? state.actionItems.filter(task => !(context.deletedTaskIds || []).includes(task.id)) : [] };
}
