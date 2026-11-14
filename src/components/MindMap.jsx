import React, { useState } from 'react';
import { ReactFlow, Background, Controls, Panel } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './mindmap.css';

// Box sizes, matching mindmap.css. (Zoomed-in main point is 280 wide.)
const BOX_WIDTH = { main: 240, point: 170, detail: 170 };
const BOX_HEIGHT = { main: 56, point: 44, detail: 34 };   // close enough for centering

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

    return {
      id: node.id,
      position,
      data: { label },
      className: `shape-${level}${isFocus ? ' is-focus' : ''}`,   // <- picks the shape
      selected: node.id === selectedNodeId,                         // Micah: highlight the box shown in the details panel
      ariaLabel: node.label + ', importance ' + node.importance + ' out of 5. Select for details.',
      sourcePosition: sides.source,
      targetPosition: sides.target,
    };
  });

  // Click a main point -> zoom in on it.
  function handleNodeClick(event, node) {
    const clicked = allNodes.find(n => n.id === node.id);
    onSelectNode?.(node.id);                                        // Micah: open the details panel
    if (clicked.parentId === mainIdea?.id) setFocusId(clicked.id);   // zoom into main points
  }

  // Click empty space -> back to the big picture.
  function handlePaneClick() {
    setFocusId(null);
  }

  return (
    <div
      className={`mindmap mindmap-${mapStyle}`}
      style={{ height: '100%', minHeight: 400, border: '1px solid #ddd', borderRadius: 8 }}
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

