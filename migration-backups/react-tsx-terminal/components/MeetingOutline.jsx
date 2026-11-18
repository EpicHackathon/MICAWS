import React, { useState } from 'react';
import { addNode, editNode, deleteNode, moveNode } from '../shared/mapEdits.js';

export default function MeetingOutline({ state, onEdit }) {
  const [error, setError] = useState(null);
  const apply = edit => { try { onEdit?.(edit); setError(null); } catch (cause) { setError(cause.message); } };
  const branch = parent => <ul>{state.nodes.filter(node => node.parentId === parent).map(node => <li key={node.id}>
    <strong>{node.label}</strong><p>{node.summary}</p>
    {onEdit && <details><summary>Edit {node.label}</summary><form key={node.label + node.summary + node.parentId} onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      apply(current => moveNode(editNode(current, node.id, { label: data.get('label'), summary: data.get('summary') }), node.id, data.get('parent') || null));
    }}>
      <label>Title <input name="label" defaultValue={node.label} required/></label>
      <label>Details <textarea name="summary" defaultValue={node.summary} required/></label>
      <label>Parent topic <select name="parent" defaultValue={node.parentId || ''}><option value="">Independent tree</option>{state.nodes.filter(item => item.id !== node.id).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <button type="submit">Save topic</button>
      <button type="button" onClick={() => apply(current => addNode(current, node.id, { label: 'New topic', summary: 'Add details here.' }))}>Add child topic</button>
      <button type="button" onClick={() => { if (window.confirm('Delete this topic and its descendants?')) apply(current => deleteNode(current, node.id)); }}>Delete topic</button>
    </form></details>}
    {state.nodes.some(item => item.parentId === node.id) && branch(node.id)}
  </li>)}</ul>;
  return <details className="meeting-outline"><summary>Accessible outline and keyboard editing ({state.nodes.length} topics)</summary>
    {error && <p role="alert">{error}</p>}
    {onEdit && <button type="button" onClick={() => apply(current => addNode(current, null, { label: 'New tree', summary: 'Add the subject of this tree.' }))}>Add independent tree</button>}
    {branch(null)}
  </details>;
}
