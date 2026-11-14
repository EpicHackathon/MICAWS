import { ReactFlow, Background, Controls } from '@xyflow/react';
  import '@xyflow/react/dist/style.css';

  export default function MindMap({ nodes, edges }) {
    // Turn the AI's nodes into the shape React Flow needs
    const flowNodes = nodes.map((node, index) => ({
      id: node.id,
      position: { x: index * 220, y: 0 },
      data: { label: node.label },
    }));

    return (
      <div style={{ height: 500, border: '1px solid #ddd', borderRadius: 8 }}>
        <ReactFlow nodes={flowNodes} edges={edges} fitView>
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    );
  }
