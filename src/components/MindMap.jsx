import React, { useState } from 'react';
import { ReactFlow, Background, Controls } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './mindmap.css';

// Box widths, matching mindmap.css. (Zoomed-in main point is 280.)
const BOX_WIDTH = { main: 240, point: 170, detail: 170 };

// Which level is this box? Look at its parent.
function getLevel(node, mainIdea) {
  if (node.parentId === null) return 'main';              // no parent -> main idea
  if (node.parentId === mainIdea?.id) return 'point';     // parent is the main idea -> main point
  return 'detail';                                        // anything else -> detail
}

export default function MindMap({ nodes: allNodes, edges: allEdges }) {
  // focusId = the main point you clicked. null means "big picture".
  const [focusId, setFocusId] = useState(null);

  const mainIdea = allNodes.find(node => node.parentId === null);

  // Who sits at the TOP of the tree right now?
  // Big picture: the main idea. Zoomed in: the main point you clicked.
  const top = focusId ?? mainIdea?.id;

  // Show the top + its children. Everything else stays hidden.
  const nodes = allNodes.filter(node => node.id === top || node.parentId === top);
  const edges = allEdges.filter(edge => edge.source === top);

  // Micah's tree layout: works out x/y for each box.
  const positions = new Map();
  let nextColumn = 0;
  function place(node, depth) {
    const children = nodes.filter(child => child.parentId === node.id);
    const columns = children.map(child => place(child, depth + 1));
    const column = columns.length
      ? (columns[0] + columns[columns.length - 1]) / 2
      : nextColumn++;
    positions.set(node.id, {x: column * 220, y: depth * 150});
    return column;
  }
  const root = nodes.find(node => node.id === top);
  if (root) place(root, 0);

  const flowNodes = nodes.map(node => {
    const level = getLevel(node, mainIdea);
    const isFocus = node.id === focusId;   // the main point you zoomed into

    // Zoomed-in main point shows its summary under the title. Everything else: just the label.
    const label = isFocus
      ? <><div className="node-title">{node.label}</div><div className="node-summary">{node.summary}</div></>
      : node.label;

    // React Flow pins a box by its TOP-LEFT corner.
    // Shift left by half the width so the box's CENTER lands on its spot.
    const width = isFocus ? 280 : BOX_WIDTH[level];
    const spot = positions.get(node.id) ?? { x: 0, y: 0 };

    return {
      id: node.id,
      position: { x: spot.x - width / 2, y: spot.y },
      data: { label },
      className: `shape-${level}${isFocus ? ' is-focus' : ''}`,   // <- picks the shape
    };
  });

  // Click a main point -> zoom in on it.
  function handleNodeClick(event, node) {
    const clicked = allNodes.find(n => n.id === node.id);
    if (clicked.parentId === mainIdea?.id) setFocusId(clicked.id);
  }

  // Click empty space -> back to the big picture.
  function handlePaneClick() {
    setFocusId(null);
  }

  return (
    <div style={{ height: '100%', minHeight: 400, border: '1px solid #ddd', borderRadius: 8 }}>
      <ReactFlow
        key={nodes.map(node => node.id).join('|')}
        nodes={flowNodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        fitView
        defaultEdgeOptions={{ type: 'step' }}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}

