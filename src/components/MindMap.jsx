import React, { useState, useEffect, useRef } from 'react';
import { ReactFlow, Background, Controls, Panel } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './mindmap.css';

// Box sizes, matching mindmap.css. (Zoomed-in main point is 280 wide.)
const BOX_WIDTH = { main: 240, point: 170, detail: 196 };
const FOCUS_WIDTH = 280;

// Spacing between boxes
const TREE_COLUMN = 220;   // tree: distance between neighbouring columns (must be > widest pill, 196)
const LEVEL_GAP = 56;      // tree: gap between a level and the level below it
const LINEAR_GAP_X = 100;  // linear: gap between a level and the level to its right
const STACK_GAP = 18;      // linear: gap between stacked boxes
const BUBBLE_START = 0;    // bubble: first child at 3 o'clock (0), going clockwise

// Which level is this box? Look at its parent.
// (Works for any depth: anything below a main point uses the detail pill shape.)
function getLevel(node, mainIdea) {
  if (node.parentId === null) return 'main';              // no parent -> main idea
  if (node.parentId === mainIdea?.id) return 'point';     // parent is the main idea -> main point
  return 'detail';                                        // anything deeper -> detail
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

/*
  LAYOUT: works out the top-left corner of every visible box, for any number of levels.
  root     = the box at the top (main idea, or the main point you zoomed into)
  kidsOf   = id -> list of that box's visible children
  size     = id -> { width, height }
  Returns  Map id -> { x, y }
*/
function layout(mapStyle, root, kidsOf, size) {
  const pos = new Map();
  const depthOf = new Map();
  const byDepth = [];   // byDepth[d] = boxes on level d
  (function walk(node, d) {
    depthOf.set(node.id, d);
    (byDepth[d] ??= []).push(node);
    kidsOf(node.id).forEach(kid => walk(kid, d + 1));
  })(root, 0);
  // how many "leaves" (boxes with no children) sit under each box: bigger families get more room
  const leaves = id => { const kids = kidsOf(id); return kids.length ? kids.reduce((s, k) => s + leaves(k.id), 0) : 1; };

  if (mapStyle === 'tree') {
    // Leaves get columns left-to-right; a parent sits centered over its children (Micah's idea).
    // Each level starts just below the tallest box of the level above.
    const levelTop = [0];
    byDepth.forEach((row, d) => {
      levelTop[d + 1] = levelTop[d] + Math.max(...row.map(n => size.get(n.id).height)) + LEVEL_GAP;
    });
    let nextColumn = 0;
    (function place(node) {
      const cols = kidsOf(node.id).map(place);
      const column = cols.length ? (cols[0] + cols[cols.length - 1]) / 2 : nextColumn++;
      pos.set(node.id, { x: column * TREE_COLUMN - size.get(node.id).width / 2, y: levelTop[depthOf.get(node.id)] });
      return column;
    })(root);
    return pos;
  }

  if (mapStyle === 'linear') {
    // Levels go left-to-right. Leaves are STACKED top-to-bottom by their real heights;
    // a parent sits halfway down its own children's stack.
    const levelLeft = [0];
    byDepth.forEach((col, d) => {
      levelLeft[d + 1] = levelLeft[d] + Math.max(...col.map(n => size.get(n.id).width)) + LINEAR_GAP_X;
    });
    const centerY = new Map();
    const shift = (id, dy) => { centerY.set(id, centerY.get(id) + dy); kidsOf(id).forEach(k => shift(k.id, dy)); };
    let cursor = 0;
    (function stack(node) {
      const h = size.get(node.id).height;
      const kids = kidsOf(node.id);
      if (!kids.length) {                       // leaf: next spot in the stack
        centerY.set(node.id, cursor + h / 2);
        cursor += h + STACK_GAP;
        return;
      }
      const start = cursor;
      kids.forEach(stack);
      const span = cursor - STACK_GAP - start;  // height of this box's children stack
      if (h > span) {                           // parent taller than its kids: make room
        kids.forEach(k => shift(k.id, (h - span) / 2));
        cursor += h - span;
      }
      centerY.set(node.id, (centerY.get(kids[0].id) + centerY.get(kids[kids.length - 1].id)) / 2);
    })(root);
    for (const [id, cy] of centerY) {
      pos.set(id, { x: levelLeft[depthOf.get(id)], y: cy - size.get(id).height / 2 });
    }
    return pos;
  }

  // BUBBLE: the top box sits in the middle. Each level is an oval ring around it.
  // Every box gets a "slice" of the circle (bigger families get bigger slices);
  // its children spread out inside that slice on the next ring out.
  const radius = [0];
  for (let d = 1; d < byDepth.length; d++) {
    // ring must be big enough to fit everyone on it, and well outside the previous ring
    radius[d] = Math.max(radius[d - 1] + (d === 1 ? 190 : 170), (byDepth[d].length * 205) / (2 * Math.PI));
  }
  const OVAL = 1.45;   // stretch sideways: boxes are wider than they are tall
  (function spread(node, from, to) {
    const d = depthOf.get(node.id);
    const angle = (from + to) / 2;
    const cx = d ? Math.cos(angle) * radius[d] * OVAL : 0;
    const cy = d ? Math.sin(angle) * radius[d] : 0;
    const { width, height } = size.get(node.id);
    pos.set(node.id, { x: cx - width / 2, y: cy - height / 2 });
    const kids = kidsOf(node.id);
    const total = kids.reduce((s, k) => s + leaves(k.id), 0);
    let a = from;
    kids.forEach(kid => {
      const slice = ((to - from) * leaves(kid.id)) / total;
      spread(kid, a, a + slice);
      a += slice;
    });
  })(root, BUBBLE_START, BUBBLE_START + 2 * Math.PI);
  return pos;
}

export default function MindMap({ nodes: allNodes, edges: allEdges, selectedNodeId, onSelectNode }) {
  // focusId = the main point you clicked. null means "big picture".
  const [focusId, setFocusId] = useState(null);
  // mapStyle = 'tree', 'linear' or 'bubble'
  const [mapStyle, setMapStyle] = useState('tree');
  // showAll = full detail view: every level at once
  const [showAll, setShowAll] = useState(false);

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
      // walk up until we reach the main point this topic belongs to
      let current = node;
      while (current && current.parentId !== null && current.parentId !== main?.id) current = byId.get(current.parentId);
      if (current && current.parentId === main?.id) pointsToDot.add(current.id);
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
  // Big picture / show all: the main idea. Zoomed in: the main point you clicked.
  const top = focusId ?? mainIdea?.id;
  const fullView = showAll && !focusId;

  // Which boxes are visible?
  //  - Show all: everything.
  //  - Otherwise: the top box + its children.
  const nodes = fullView
    ? allNodes
    : allNodes.filter(node => node.id === top || node.parentId === top);
  const visibleIds = new Set(nodes.map(node => node.id));
  const edges = allEdges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target));

  // Size of every visible box (see estimateHeight).
  const size = new Map(nodes.map(node => {
    const isFocus = node.id === focusId;
    const level = getLevel(node, mainIdea);
    return [node.id, {
      width: isFocus ? FOCUS_WIDTH : BOX_WIDTH[level],
      height: estimateHeight(node, level, isFocus),
    }];
  }));
  const kidsOf = id => nodes.filter(node => node.parentId === id);
  const root = nodes.find(node => node.id === top);
  const positions = root ? layout(mapStyle, root, kidsOf, size) : new Map();

  const sides = LINE_SIDES[mapStyle];

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

    // Dot only on main points (not while you're zoomed into it).
    const hasUnread = level === 'point' && !isFocus && unread.has(node.id);

    return {
      id: node.id,
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: { label },
      className: `shape-${level}${isFocus ? ' is-focus' : ''}${hasUnread ? ' has-unread' : ''}`,   // <- picks the shape
      selected: node.id === selectedNodeId,                         // Micah: highlight the box shown in the details panel
      ariaLabel: node.label + (hasUnread ? ', has new updates' : '') + ', importance ' + node.importance + ' out of 5. Select for details.',
      sourcePosition: sides.source,
      targetPosition: sides.target,
    };
  });

  // Click a main point -> zoom in on it (also from the Show all view).
  function handleNodeClick(event, node) {
    const clicked = allNodes.find(n => n.id === node.id);
    // Team design: clicking a main point zooms in (summary shows inside the box).
    // Micah's details panel still opens from the topic list view.
    if (clicked.parentId === mainIdea?.id) {
      setFocusId(clicked.id);
      setShowAll(false);
    }
    markRead([clicked.id]);   // you looked at it, so its dot goes away
  }

  // Click empty space -> back to the big picture (does nothing in Show all).
  // Leaving a zoomed-in point counts as having seen its details.
  function handlePaneClick() {
    if (focusId) markRead([focusId]);
    setFocusId(null);
  }

  // Show all on/off. Turning it on from a zoomed-in point goes back out first.
  function toggleShowAll() {
    if (focusId) markRead([focusId]);
    setFocusId(null);
    setShowAll(current => !current);
  }

  return (
    <div
      className={`mindmap mindmap-${mapStyle}`}
      /* size, border and colors come from mindmap.css (theme-aware) */
    >
      <ReactFlow
        key={mapStyle + '|' + (fullView ? 'all|' : '') + nodes.map(node => node.id).join('|')}
        nodes={flowNodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ maxZoom: 1 }}
        minZoom={0.1}
        defaultEdgeOptions={{ type: sides.edgeType }}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
      >
        <Panel position="top-right">
          <div className="map-controls">
            <button
              type="button"
              className="show-all-toggle"
              aria-pressed={fullView}
              onClick={toggleShowAll}
            >
              {fullView ? 'Big picture' : 'Show all'}
            </button>
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
          </div>
        </Panel>
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
