import React, { useState, useEffect, useRef } from 'react';
import { ReactFlow, Background, Controls, Panel } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './mindmap.css';

// Box sizes, matching mindmap.css. (Zoomed-in main point is 280 wide.)
const BOX_WIDTH = { main: 240, point: 170, detail: 196 };
const BOX_HEIGHT = { main: 56, point: 44, detail: 58 };   // close enough for centering

// Which level is this box? Look at its parent.
function getLevel(node, mainIdea) {
  if (node.parentId === null) return 'main';              // no parent -> main idea
  if (node.parentId === mainIdea?.id) return 'point';     // parent is the main idea -> main point
  return 'detail';                                        // anything else -> detail
}

// Where does the CENTER of a box go, for each map style?
// column = side-to-side slot, depth = level (0 = top), index/count = which child out of how many.
function centerFor(mapStyle, { column, depth, index, count }) {
  if (mapStyle === 'tree') {
    return { x: column * 220, y: depth * 150 };           // columns go across, levels go down
  }
  if (mapStyle === 'linear') {
    return { x: depth * 380, y: column * 70 };            // SWAPPED: levels go across, columns go down
  }
  // bubble: the top box sits in the middle, children go around it in an oval
  if (depth === 0) return { x: 0, y: 0 };
  const angle = 0 + (index / count) * 2 * Math.PI;   // start at 12 o'clock, go clockwise
  const radiusX = 400 + count * 12;
  const radiusY = 150 + count * 8;
  return { x: Math.cos(angle) * radiusX, y: Math.sin(angle) * radiusY };
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

  // UNREAD DOTS: ids of topics that got new info nobody has looked at yet.
  const [unread, setUnread] = useState(() => new Set());
  const lastSeen = useRef(null);   // what each topic said last time: id -> "label|summary"
  useEffect(() => {
    const now = new Map(allNodes.map(node => [node.id, node.label + '|' + node.summary]));
    const before = lastSeen.current;
    // Skip the very first load (and loading into an empty map): nothing is "new" yet.
    if (before && before.size > 0) {
      const changed = allNodes.filter(node => before.get(node.id) !== now.get(node.id)).map(node => node.id);
      if (changed.length) setUnread(current => new Set([...current, ...changed]));
    }
    lastSeen.current = now;
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

  const flowNodes = nodes.map(node => {
    const level = getLevel(node, mainIdea);
    const isFocus = node.id === focusId;   // the main point you zoomed into

    // Zoomed-in main point shows its summary under the title. Everything else: just the label.
    const label = isFocus
      ? <><div className="node-title">{node.label}</div><div className="node-summary">{node.summary}</div></>
      : level === 'detail'
        // A2 "peek line": detail pill shows its title + one short line from its summary
        ? <><div className="detail-title">{node.label}</div><div className="detail-summary">{node.summary}</div></>
        : node.label;

    // React Flow pins a box by its TOP-LEFT corner.
    // Shift by half the width (and height) so the box's CENTER lands on its spot.
    const width = isFocus ? 280 : BOX_WIDTH[level];
    const height = isFocus ? 100 : BOX_HEIGHT[level];
    const slot = slots.get(node.id) ?? { column: 0, depth: 0 };
    const center = centerFor(mapStyle, {
      ...slot,
      index: children.indexOf(node),
      count: children.length,
    });
    const position = mapStyle === 'tree'
      ? { x: center.x - width / 2, y: center.y }                     // tree: keep each row's tops lined up
      : mapStyle === 'linear'
        ? { x: center.x, y: center.y - height / 2 }                  // linear: keep each column's left edges lined up
        : { x: center.x - width / 2, y: center.y - height / 2 };     // bubble: center both ways

    // Show a red dot if this topic is unread. In the big picture, a main point also gets
    // a dot when one of its hidden details is unread ("click me, something changed in here").
    const hiddenKidUnread = level === 'point' && !isFocus
      && allNodes.some(kid => kid.parentId === node.id && unread.has(kid.id));
    const hasUnread = unread.has(node.id) || hiddenKidUnread;

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
    if (focusId) markRead(allNodes.filter(node => node.parentId === focusId).map(node => node.id));
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

