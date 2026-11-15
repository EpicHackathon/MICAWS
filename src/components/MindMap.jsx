import React, { useState, useEffect, useRef } from 'react';
import { ReactFlow, Background, Controls, Panel } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './mindmap.css';

// Box sizes, matching mindmap.css. (Zoomed-in main point is 280 wide.)
const BOX_WIDTH = { main: 240, point: 170, detail: 196 };

// Which level is this box? Look at its parent.
function getLevel(node, mainIdea) {
  if (node.parentId === null) return 'main';              // no parent -> main idea
  if (node.parentId === mainIdea?.id) return 'point';     // parent is the main idea -> main point
  return 'detail';                                        // anything else -> detail
}

// Where does the CENTER of a box go, for each map style?
// column = side-to-side slot, depth = level (0 = top), index/count = which child out of how many.
// (Tree and Linear are worked out inside MindMap, using each box's real height.)
function centerFor(mapStyle, { depth, index, count }) {
  // bubble: the top box sits in the middle, children go around it in an oval
  if (depth === 0) return { x: 0, y: 0 };
  const angle = 0 + (index / count) * 2 * Math.PI;   // start at 12 o'clock, go clockwise
  const radiusX = 400 + count * 12;
  const radiusY = 150 + count * 8;
  return { x: Math.cos(angle) * radiusX, y: Math.sin(angle) * radiusY };
}

// Rough height of a box, worked out from how much text it has (box widths are fixed,
// so longer text = more lines = taller box). Used so boxes never overlap.
// Slightly over-estimates on purpose: a little extra gap is better than touching boxes.
function estimateHeight(node, level, isFocus) {
  const lines = (text, charsPerLine) => Math.max(1, Math.ceil((text ?? '').length / charsPerLine));
  if (isFocus) return 34 + lines(node.label, 24) * 22 + 6 + lines(node.summary, 37) * 19;
  if (level === 'main') return 37 + lines(node.label, 19) * 22;
  if (level === 'point') return 27 + lines(node.label, 16) * 19;
  // detail pill: title (up to 2 lines) + summary (cut off at 2 lines)
  return 24 + Math.min(2, lines(node.label, 19)) * 17 + 2 + Math.min(2, lines(node.summary, 24)) * 16;
}

// Which side of the box do the lines connect to?
const LINE_SIDES = {
  tree:   { source: 'bottom', target: 'top',  edgeType: 'step' },
  linear: { source: 'right',  target: 'left', edgeType: 'step' },
  bubble: { source: 'bottom', target: 'top',  edgeType: 'straight' },  // bubble lines start from the center (see mindmap.css)
};

export default function MindMap({ nodes: allNodes, edges: allEdges, selectedNodeId, onSelectNode }) {
  // focusId = the main point you clicked. null means "big picture".
  const [focusId, setFocusId] = useState(null);
  // mapStyle = 'tree', 'linear' or 'bubble'
  const [mapStyle, setMapStyle] = useState('tree');

  // UNREAD DOTS: ids of MAIN POINTS that got new info (live) nobody has looked at yet.
  // Only main points (the rounded rectangles) ever get a dot.
  const [unread, setUnread] = useState(() => new Set());
  const lastSeen = useRef(null);       // what each topic said last time: id -> "label|summary"
  const focusRef = useRef(focusId);    // which point you're looking at right now
  focusRef.current = focusId;
  useEffect(() => {
    const now = new Map(allNodes.map(node => [node.id, node.label + '|' + node.summary]));
    const before = lastSeen.current;
    lastSeen.current = now;
    if (!before) return;   // first time the map appears: nothing is "new" yet

    // A completely different meeting (e.g. "Load sample meeting")? That's not live talk: no dots.
    const sameMeeting = [...now.keys()].some(id => before.has(id));
    if (!sameMeeting) { setUnread(new Set()); return; }

    // Live update: find what changed, then point the dot at its MAIN POINT.
    const main = allNodes.find(node => node.parentId === null);
    const byId = new Map(allNodes.map(node => [node.id, node]));
    const pointsToDot = new Set();
    for (const node of allNodes) {
      if (before.get(node.id) === now.get(node.id)) continue;      // unchanged
      if (node.parentId === main?.id) pointsToDot.add(node.id);    // a main point changed
      else if (byId.get(node.parentId)?.parentId === main?.id) pointsToDot.add(node.parentId); // one of its details changed
    }
    pointsToDot.delete(focusRef.current);   // you're already looking at that one
    if (pointsToDot.size) setUnread(current => new Set([...current, ...pointsToDot]));
  }, [allNodes]);

  function markRead(ids) {
    setUnread(current => {
      const next = new Set(current);
      ids.forEach(id => next.delete(id));
      return next;
    });
  }

  const mainIdea = allNodes.find(node => node.parentId === null);

  // Who sits at the TOP of the tree right now?
  // Big picture: the main idea. Zoomed in: the main point you clicked.
  const top = focusId ?? mainIdea?.id;

  // Show the top + its children. Everything else stays hidden.
  const nodes = allNodes.filter(node => node.id === top || node.parentId === top);
  const edges = allEdges.filter(edge => edge.source === top);
  const children = nodes.filter(node => node.id !== top);

  // Micah's tree layout, now saving the column + depth of each box (not pixels yet).
  const slots = new Map();
  let nextColumn = 0;
  function place(node, depth) {
    const kids = nodes.filter(child => child.parentId === node.id);
    const columns = kids.map(child => place(child, depth + 1));
    const column = columns.length
      ? (columns[0] + columns[columns.length - 1]) / 2
      : nextColumn++;
    slots.set(node.id, { column, depth });
    return column;
  }
  const root = nodes.find(node => node.id === top);
  if (root) place(root, 0);

  const sides = LINE_SIDES[mapStyle];

  // Real-ish height of every visible box (see estimateHeight).
  const heights = new Map(nodes.map(node =>
    [node.id, estimateHeight(node, getLevel(node, mainIdea), node.id === focusId)]));
  const topHeight = heights.get(top) ?? 60;
  const topWidth = focusId ? 280 : BOX_WIDTH.main;

  // Linear: work out where each child's top edge goes, stacking them in order with an 18px gap.
  const GAP = 18;
  const linearTop = new Map();
  let nextY = 0;
  for (const kid of [...children].sort((a, b) => slots.get(a.id).column - slots.get(b.id).column)) {
    linearTop.set(kid.id, nextY);
    nextY += heights.get(kid.id) + GAP;
  }
  const stackHeight = Math.max(topHeight, nextY - GAP);

  const flowNodes = nodes.map(node => {
    const level = getLevel(node, mainIdea);
    const isFocus = node.id === focusId;   // the main point you zoomed into

    // Zoomed-in main point shows its summary under the title. Everything else: just the label.
    const label = isFocus
      ? <><div className="node-title">{node.label}</div><div className="node-summary">{node.summary}</div></>
      : level === 'detail'
        // A2 "peek line": detail pill shows its title + one short line from its summary
        ? <><div className="detail-title">{node.label}</div><div className="detail-summary" title={node.summary}>{node.summary}</div></>
        : node.label;

    // React Flow pins a box by its TOP-LEFT corner.
    // Shift by half the width (and height) so the box's CENTER lands on its spot.
    const width = isFocus ? 280 : BOX_WIDTH[level];
    const height = heights.get(node.id);
    const slot = slots.get(node.id) ?? { column: 0, depth: 0 };
    const isTop = node.id === top;
    let position;
    if (mapStyle === 'tree') {
      // Tree: columns go across. Children's row starts just below the (real) height of the top box.
      position = { x: slot.column * 220 - width / 2, y: isTop ? 0 : topHeight + 56 };
    } else if (mapStyle === 'linear') {
      // Linear: children are STACKED by their real heights, so a 2-line box pushes the next one down.
      // The top box sits halfway down the stack.
      position = isTop
        ? { x: 0, y: stackHeight / 2 - height / 2 }
        : { x: topWidth + 100, y: linearTop.get(node.id) };
    } else {
      // Bubble: children go around the top box in an oval.
      const center = centerFor(mapStyle, { ...slot, index: children.indexOf(node), count: children.length });
      position = { x: center.x - width / 2, y: center.y - height / 2 };
    }

    // Dot only on main points in the big picture (not while you're zoomed into it).
    const hasUnread = level === 'point' && !isFocus && unread.has(node.id);

    return {
      id: node.id,
      position,
      data: { label },
      className: `shape-${level}${isFocus ? ' is-focus' : ''}${hasUnread ? ' has-unread' : ''}`,   // <- picks the shape
      selected: node.id === selectedNodeId,                         // Micah: highlight the box shown in the details panel
      ariaLabel: node.label + (hasUnread ? ', has new updates' : '') + ', importance ' + node.importance + ' out of 5. Select for details.',
      sourcePosition: sides.source,
      targetPosition: sides.target,
    };
  });

  // Click a main point -> zoom in on it.
  function handleNodeClick(event, node) {
    const clicked = allNodes.find(n => n.id === node.id);
    // Team design: clicking a main point zooms in (summary shows inside the box).
    // Micah's details panel still opens from the topic list view.
    if (clicked.parentId === mainIdea?.id) setFocusId(clicked.id);
    markRead([clicked.id]);   // you looked at it, so its dot goes away
  }

  // Click empty space -> back to the big picture.
  // Leaving a zoomed-in point counts as having seen its details.
  function handlePaneClick() {
    if (focusId) markRead([focusId]);
    setFocusId(null);
  }

  return (
    <div
      className={`mindmap mindmap-${mapStyle}`}
      /* size, border and colors come from mindmap.css (theme-aware) */
    >
      <ReactFlow
        key={mapStyle + '|' + nodes.map(node => node.id).join('|')}
        nodes={flowNodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ maxZoom: 1 }}
        defaultEdgeOptions={{ type: sides.edgeType }}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
      >
        <Panel position="top-right">
          <div className="style-switch" role="group" aria-label="Map style">
            {['tree', 'linear', 'bubble'].map(name => (
              <button
                key={name}
                type="button"
                aria-pressed={mapStyle === name}
                onClick={() => setMapStyle(name)}
              >
                {name[0].toUpperCase() + name.slice(1)}
              </button>
            ))}
          </div>
        </Panel>
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

