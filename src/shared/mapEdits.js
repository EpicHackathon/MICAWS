// Edits people make by hand on the mind map (move, rename, delete).
// Every function takes a meeting state { nodes, edges, actionItems } and returns a NEW state.
// They throw an Error with a friendly message when the edit isn't allowed, and always return
// a state that still passes meetingSchema (one root, max 5 levels, one edge per parent link).

export const MAX_LEVELS = 5;

const byId = state => new Map(state.nodes.map(node => [node.id, node]));

// Edges always mirror parentId exactly: one edge per non-root node, id "<parent>-<child>".
export function rebuildEdges(nodes) {
  return nodes
    .filter(node => node.parentId !== null)
    .map(node => ({ id: `${node.parentId}-${node.id}`, source: node.parentId, target: node.id }));
}

// The node itself plus everything below it.
export function subtreeIds(state, id) {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of state.nodes) {
      if (node.parentId !== null && ids.has(node.parentId) && !ids.has(node.id)) { ids.add(node.id); grew = true; }
    }
  }
  return ids;
}

// Level of a node: main idea = 1, main point = 2, detail = 3, ...
function levelOf(nodes, id) {
  let level = 1;
  for (let node = nodes.get(id); node && node.parentId !== null; node = nodes.get(node.parentId)) level += 1;
  return level;
}

// How many levels a branch has, counting the node itself (a node with no children = 1).
function branchHeight(state, id) {
  const kids = state.nodes.filter(node => node.parentId === id);
  return 1 + (kids.length ? Math.max(...kids.map(kid => branchHeight(state, kid.id))) : 0);
}

// Move a node (and everything under it) so it becomes a child of newParentId.
export function moveNode(state, id, newParentId) {
  const nodes = byId(state);
  const node = nodes.get(id);
  const parent = nodes.get(newParentId);
  if (!node || !parent) throw new Error('That topic no longer exists.');
  if (node.parentId === null) throw new Error("The main idea can't be moved.");
  if (node.parentId === newParentId) return state;   // already there
  if (subtreeIds(state, id).has(newParentId)) throw new Error("A topic can't go inside its own branch.");
  if (levelOf(nodes, newParentId) + branchHeight(state, id) > MAX_LEVELS) {
    throw new Error(`That would make the map deeper than ${MAX_LEVELS} levels.`);
  }
  const next = state.nodes.map(n => (n.id === id ? { ...n, parentId: newParentId } : n));
  return { ...state, nodes: next, edges: rebuildEdges(next) };
}

// Change a node's title and/or summary.
export function editNode(state, id, { label, summary }) {
  const clean = text => (typeof text === 'string' ? text.trim() : undefined);
  const newLabel = clean(label);
  const newSummary = clean(summary);
  if (newLabel === '') throw new Error('The title can’t be empty.');
  if (newSummary === '') throw new Error('The summary can’t be empty.');
  if (!state.nodes.some(node => node.id === id)) throw new Error('That topic no longer exists.');
  return {
    ...state,
    nodes: state.nodes.map(node => (node.id === id
      ? { ...node, ...(newLabel !== undefined && { label: newLabel }), ...(newSummary !== undefined && { summary: newSummary }) }
      : node)),
  };
}

// Delete a node and everything under it.
export function deleteNode(state, id) {
  const node = state.nodes.find(n => n.id === id);
  if (!node) return state;
  if (node.parentId === null) throw new Error("The main idea can't be deleted. Use Reset session to start over.");
  const gone = subtreeIds(state, id);
  const next = state.nodes.filter(n => !gone.has(n.id));
  return { ...state, nodes: next, edges: rebuildEdges(next) };
}
