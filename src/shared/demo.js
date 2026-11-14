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

export function getDemoState(segments, previousState) {
  // Cumulative matching also works if the user queues multiple batches before a request.
  const latest = demoBatches.findLastIndex(batch => batch.some(example =>
    segments.some(segment => example.time === segment.time && example.text === segment.text),
  ));
  if (latest < 0) return previousState;

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
  return {
    nodes: merge(previousState.nodes, sample.nodes, true),
    edges: merge(previousState.edges, sample.edges, false),
    actionItems: merge(previousState.actionItems, sample.actionItems, false),
  };
}
