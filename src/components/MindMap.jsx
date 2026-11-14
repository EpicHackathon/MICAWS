import React from 'react';
import { ReactFlow, Background, Controls } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

export default function MindMap({ nodes, edges, selectedNodeId, onSelectNode }) {
  const positions = new Map();
  let nextColumn = 0;
  function place(node, depth) {
    const children = nodes.filter(child => child.parentId === node.id);
    const columns = children.map(child => place(child, depth + 1));
    const column = columns.length
      ? (columns[0] + columns[columns.length - 1]) / 2
      : nextColumn++;
    positions.set(node.id, { x: column * 220, y: depth * 150 });
    return column;
  }
  const root = nodes.find(node => node.parentId === null);
  if (root) place(root, 0);
  const flowNodes = nodes.map(node => ({
    id: node.id,
    position: positions.get(node.id) ?? { x: 0, y: 0 },
    data: { label: node.label },
    selected: node.id === selectedNodeId,
    ariaLabel: node.label + ', importance ' + node.importance + ' out of 5. Select for details.',
  }));

  // Manual edge editing is not yet supported; edges are derived from parentId.
  return (
    <div style={{ height: '100%', minHeight: 400, border: '1px solid #ddd', borderRadius: 8 }}>
      <ReactFlow
        key={nodes.map(node => node.id).join('|')}
        nodes={flowNodes}
        edges={edges}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        onNodeClick={(_, node) => onSelectNode?.(node.id)}
        fitView
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
