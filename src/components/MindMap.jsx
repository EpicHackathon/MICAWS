import { arrangeForest } from '../shared/forestLayout.js';
import React, { useState, useEffect, useRef } from 'react';
import { ReactFlow, Background, Controls, Panel, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './mindmap.css';
import { moveNode, editNode, deleteNode, subtreeIds, moveOut, addNode } from '../shared/mapEdits.js';

// Box sizes, matching mindmap.css. (Zoomed-in main point is 280 wide.)
const BOX_WIDTH = { main: 240, point: 170, detail: 196 };
const FOCUS_WIDTH = 280;

// Spacing between boxes
const TREE_COLUMN = 220;   // tree: distance between neighbouring columns (must be > widest pill, 196)
const LEVEL_GAP = 64;      // tree: gap between a level and the level below it (room for the lines)
const LINEAR_GAP_X = 100;  // linear: gap between a level and the level to its right
const STACK_GAP = 18;      // linear: gap between stacked boxes
const BUBBLE_START = 0;    // bubble: first child at 3 o'clock (0), going clockwise

// Which level is this box? Look at its parent.
// (Works for any depth: anything below a main point uses the detail pill shape.)
function getLevel(node, rootIds) {
  if (node.parentId === null) return 'main';              // no parent -> main idea
  if (rootIds.has(node.parentId)) return 'point';     // parent is the main idea -> main point
  return 'detail';                                        // anything deeper -> detail
}

// Rough height of a box, worked out from how much text it has (box widths are fixed,
// so longer text = more lines = taller box). Used so boxes never overlap.
// Slightly over-estimates on purpose: a little extra gap is better than touching boxes.
function estimateHeight(node, level, isFocus, hasKids = false) {
  const lines = (text, charsPerLine) => Math.max(1, Math.ceil((text ?? '').length / charsPerLine));
  if (isFocus) return 34 + lines(node.label, 24) * 22 + 6 + lines(node.summary, 37) * 19;
  if (level === 'main') return 37 + lines(node.label, 19) * 22;
  if (level === 'point') return 27 + lines(node.label, 16) * 19;
  // detail pill: title + FULL summary (never cut off), + a "N more" line if it has sub-details
  return 24 + lines(node.label, 19) * 17 + 2 + lines(node.summary, 24) * 16 + (hasKids ? 18 : 0);
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
function layout(mapStyle, root, kidsOf, size, compact = false) {
  const pos = new Map();

  if (mapStyle === 'tree' && compact) {
    // OUTLINE TREE (Show all): narrow and tall instead of wide.
    // Main idea on top, its children in one row, and everything under each child
    // stacked DOWNWARD in that child's column, indented one step per level.
    const OUTLINE_INDENT = 28, OUTLINE_GAP = 14, COLUMN_GAP = 40;
    const points = kidsOf(root.id);
    const columnWidth = id => {
      let widest = size.get(id).width;
      (function walk(nodeId, d) {
        kidsOf(nodeId).forEach(k => { widest = Math.max(widest, d * OUTLINE_INDENT + size.get(k.id).width); walk(k.id, d + 1); });
      })(id, 1);
      return widest;
    };
    const rowTop = size.get(root.id).height + LEVEL_GAP;
    let left = 0;
    points.forEach(point => {
      pos.set(point.id, { x: left, y: rowTop });
      let y = rowTop + size.get(point.id).height + OUTLINE_GAP;
      (function stackDown(parentId, d) {
        kidsOf(parentId).forEach(kid => {
          pos.set(kid.id, { x: left + d * OUTLINE_INDENT, y });
          y += size.get(kid.id).height + OUTLINE_GAP;
          stackDown(kid.id, d + 1);
        });
      })(point.id, 1);
      left += columnWidth(point.id) + COLUMN_GAP;
    });
    const rowWidth = Math.max(0, left - COLUMN_GAP);
    pos.set(root.id, { x: rowWidth / 2 - size.get(root.id).width / 2, y: 0 });
    return pos;
  }

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

// Re-centers the map whenever the tree's shape changes (an edit, or the AI adding topics),
// so boxes never end up off-screen. Lives inside <ReactFlow> so it can use useReactFlow.
function AutoFit({ shape }) {
  const { fitView } = useReactFlow();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }   // the first fit is done by `fitView`
    const frame = requestAnimationFrame(() => fitView({ maxZoom: 1, duration: 300 }));
    return () => cancelAnimationFrame(frame);
  }, [shape, fitView]);
  return null;
}

export default function MindMap({
  nodes: allNodes, edges: allEdges, selectedNodeId, onSelectNode, live = true, onEdit,
  onEditingChange, pendingCount = 0,
}) {
  // focusId = the main point you clicked. null means "big picture".
  const [rawFocusId, setFocusId] = useState(null);
  // If the AI merged away the topic you're zoomed into, fall back to the big picture.
  const focusId = rawFocusId && allNodes.some(node => node.id === rawFocusId) ? rawFocusId : null;
  // mapStyle = 'tree', 'linear' or 'bubble'
  const [mapStyle, setMapStyle] = useState('tree');
  // showAll = full detail view: every level at once
  const [showAll, setShowAll] = useState(false);

  // EDIT MODE: drag boxes onto other boxes, connect dots, rename, delete.
  const [editMode, setEditMode] = useState(false);
  const [editingId, setEditingId] = useState(null);      // box open in the edit panel
  const [draft, setDraft] = useState({ label: '', summary: '' });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dragPos, setDragPos] = useState(null);           // { id, x, y } while dragging
  const [dropTargetId, setDropTargetId] = useState(null); // box you'd drop onto
  const [editMessage, setEditMessage] = useState(null);   // "can't do that" messages
  const [measured, setMeasured] = useState({});            // id -> size React Flow measured
  const [editNotice, setEditNotice] = useState(null);     // "Moved X inside Y" messages
  const [newTitle, setNewTitle] = useState('');            // "Add a topic inside" box
  const dragStart = useRef(null);                          // where a dragged box started

  // Tell the app when we're editing, so it pauses AI map updates (recording keeps going).
  const editingChangeRef = useRef(onEditingChange);
  editingChangeRef.current = onEditingChange;
  useEffect(() => {
    editingChangeRef.current?.(editMode);
  }, [editMode]);
  useEffect(() => () => editingChangeRef.current?.(false), []);   // leaving the map un-pauses

  // Run an edit (a function from src/shared/mapEdits.js). Shows a message if it's refused.
  function tryEdit(edit) {
    try {
      onEdit(edit);
      setEditMessage(null);
      setEditNotice(null);
      return true;
    } catch (error) {
      setEditMessage(error.message);
      setEditNotice(null);
      return false;
    }
  }

  // UNREAD DOTS: ids of MAIN POINTS that got new info (live) nobody has looked at yet.
  // Only main points (the rounded rectangles) ever get a dot.
  const [unread, setUnread] = useState(() => new Set());
  // what each topic said last time: id -> "label|summary".
  // A live meeting starts from "nothing said yet", so its very first topics get dots too.
  const lastSeen = useRef(live ? new Map() : null);
  const focusRef = useRef(focusId);    // which point you're looking at right now
  focusRef.current = focusId;
  useEffect(() => {
    const now = new Map(allNodes.map(node => [node.id, node.label + '|' + node.summary]));
    const before = lastSeen.current;
    lastSeen.current = now;
    // The sample meeting is not live talk: never any dots.
    if (!live || !before) { setUnread(new Set()); return; }

    // Switched to a completely different meeting (e.g. back from the sample)? No dots.
    // (An empty "before" means the live meeting just started: everything counts as new.)
    const sameMeeting = before.size === 0 || [...now.keys()].some(id => before.has(id));
    if (!sameMeeting) { setUnread(new Set()); return; }

    // Live update: find what changed, then point the dot at its MAIN POINT.
    const mainIds = new Set(allNodes.filter(node => node.parentId === null).map(node => node.id));
    const byId = new Map(allNodes.map(node => [node.id, node]));
    const pointsToDot = new Set();
    for (const node of allNodes) {
      if (before.get(node.id) === now.get(node.id)) continue;      // unchanged
      // walk up until we reach the main point this topic belongs to
      let current = node;
      while (current && current.parentId !== null && !mainIds.has(current.parentId)) current = byId.get(current.parentId);
      if (current && mainIds.has(current.parentId)) pointsToDot.add(current.id);
    }
    pointsToDot.delete(focusRef.current);   // you're already looking at that one
    if (pointsToDot.size) setUnread(current => new Set([...current, ...pointsToDot]));
  }, [allNodes, live]);

  function markRead(ids) {
    setUnread(current => {
      const next = new Set(current);
      ids.forEach(id => next.delete(id));
      return next;
    });
  }

  const roots = allNodes.filter(node => node.parentId === null);
  const rootIds = new Set(roots.map(node => node.id));

  // Who sits at the TOP of the tree right now?
  // Big picture / show all: the main idea. Zoomed in: the main point you clicked.
  const top = focusId;
  const fullView = showAll && !focusId;

  // Which boxes are visible?
  //  - Show all: everything.
  //  - Otherwise: the top box + its children.
  const nodes = fullView
    ? allNodes
    : allNodes.filter(node => top ? node.id === top || node.parentId === top : node.parentId === null || rootIds.has(node.parentId));
  const visibleIds = new Set(nodes.map(node => node.id));
  const edges = allEdges
    .filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target))
    .map(edge => ({ ...edge, selectable: false, focusable: false }));   // lines aren't clickable

  // Does this box have children (anywhere in the meeting)? Those can be clicked to go deeper.
  const hasKids = id => allNodes.some(node => node.parentId === id);
  // In the normal (not Show all) view, details with hidden sub-details say "N more".
  const hiddenKidCount = id => fullView ? 0 : allNodes.filter(node => node.parentId === id).length;

  // Size of every visible box (see estimateHeight).
  const size = new Map(nodes.map(node => {
    const isFocus = node.id === focusId;
    const level = getLevel(node, rootIds);
    return [node.id, {
      width: isFocus ? FOCUS_WIDTH : BOX_WIDTH[level],
      // Use the REAL height React Flow measured; the estimate is only for the first instant
      // before a box has been measured (then the layout redoes itself with the real size).
      height: measured[node.id]?.height
        ?? estimateHeight(node, level, isFocus, level === 'detail' && hiddenKidCount(node.id) > 0),
    }];
  }));
  const kidsOf = id => nodes.filter(node => node.parentId === id);
  const visibleRoots = top ? nodes.filter(node => node.id === top) : roots;
  // Show all + Tree uses the narrow "outline" layout (details stack downward under each point).
  const compact = mapStyle === 'tree' && fullView;
  const positions = arrangeForest(visibleRoots.map(root => layout(mapStyle, root, kidsOf, size, compact)), size);

  const sides = LINE_SIDES[mapStyle];
  // Which sides the lines attach to. Outline tree: main idea -> points from the top,
  // then everything below hangs off the LEFT side like an indented list.
  const sidesFor = node => {
    if (!compact) return sides;
    if (node.parentId === null) return { source: 'bottom', target: 'top' };
    if (rootIds.has(node.parentId)) return { source: 'left', target: 'top' };
    return { source: 'left', target: 'left' };
  };

  // While dragging in edit mode: which box is under the middle of the dragged box?
  function findDropTarget(dragId, x, y) {
    const { width, height } = size.get(dragId);
    const cx = x + width / 2, cy = y + height / 2;
    const ownBranch = new Set([dragId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of allNodes) if (n.parentId && ownBranch.has(n.parentId) && !ownBranch.has(n.id)) { ownBranch.add(n.id); grew = true; }
    }
    for (const n of nodes) {
      if (ownBranch.has(n.id)) continue;
      const p = positions.get(n.id), s = size.get(n.id);
      if (p && cx >= p.x && cx <= p.x + s.width && cy >= p.y && cy <= p.y + s.height) return n.id;
    }
    return null;
  }

  function handleNodesChange(changes) {
    // React Flow measures every box and reports the size here. We MUST keep those sizes and
    // hand them back on each render, or React Flow treats boxes as size-less and hides them.
    const sizes = changes.filter(change => change.type === 'dimensions' && change.dimensions);
    if (sizes.length) {
      setMeasured(current => {
        let next = current;
        for (const { id, dimensions } of sizes) {
          const old = current[id];
          if (!old || old.width !== dimensions.width || old.height !== dimensions.height) {
            if (next === current) next = { ...current };
            next[id] = { width: dimensions.width, height: dimensions.height };
          }
        }
        return next;
      });
    }
    if (!editMode) return;
    for (const change of changes) {
      if (change.type === 'position' && change.dragging && change.position) {
        setDragPos({ id: change.id, ...change.position });
        setDropTargetId(findDropTarget(change.id, change.position.x, change.position.y));
      }
    }
  }

  // Move a box inside another and say where it went (it may now be hidden inside that box).
  function moveInto(id, newParentId) {
    const moved = allNodes.find(n => n.id === id);
    const parent = allNodes.find(n => n.id === newParentId);
    if (!moved || !parent || moved.parentId === newParentId) return;
    if (tryEdit(state => moveNode(state, id, newParentId))) {
      const hidden = !fullView && newParentId !== top;
      setEditNotice(`Moved “${moved.label}” inside “${parent.label}”.` + (hidden ? ` Open “${parent.label}” to see it.` : ''));
    }
  }

  function handleNodeDragStart(event, node) {
    dragStart.current = positions.get(node.id) ?? null;
  }

  function handleNodeDragStop(event, node) {
    const start = dragStart.current;
    const end = dragPos?.id === node.id ? dragPos : null;
    const movedFar = start && end && Math.hypot(end.x - start.x, end.y - start.y) > 80;
    if (dropTargetId) {
      moveInto(node.id, dropTargetId);            // dropped ON a box: goes inside it
    } else if (movedFar) {
      // dropped on EMPTY space: moves OUT one level (becomes a sibling of its parent)
      const moved = allNodes.find(n => n.id === node.id);
      const oldParent = allNodes.find(n => n.id === moved?.parentId);
      const newParent = allNodes.find(n => n.id === oldParent?.parentId);
      if (tryEdit(state => moveOut(state, node.id)) && newParent) {
        setEditNotice(`Moved “${moved.label}” out of “${oldParent.label}”.`);
        if (focusId === oldParent.id) setFocusId(newParent.parentId === null ? null : newParent.id);
      }
    }
    dragStart.current = null;
    setDragPos(null);
    setDropTargetId(null);
  }

  // Connect the dots: drag from box A's dot to box B's dot -> B goes inside A.
  function handleConnect({ source, target }) {
    if (source && target) moveInto(target, source);
  }

  function openEditor(node) {
    setEditingId(node.id);
    setDraft({ label: node.label, summary: node.summary });
    setConfirmDelete(false);
    setEditMessage(null);
    setNewTitle('');
  }

  // Add a new topic inside the box that's open in the edit panel (title only).
  function addInside(parent) {
    if (tryEdit(state => addNode(state, parent.id, { label: newTitle }))) {
      const hidden = !fullView && parent.id !== top;
      setEditNotice(`Added “${newTitle.trim()}” inside “${parent.label}”.` + (hidden ? ` Open “${parent.label}” to see it.` : ''));
      setNewTitle('');
    }
  }
  const editingNode = editMode ? allNodes.find(node => node.id === editingId) : null;
  const editingBranchSize = editingNode ? subtreeIds({ nodes: allNodes }, editingNode.id).size - 1 : 0;

  const flowNodes = nodes.map(node => {
    const level = getLevel(node, rootIds);
    const isFocus = node.id === focusId;   // the main point you zoomed into

    // Zoomed-in main point shows its summary under the title. Everything else: just the label.
    const more = level === 'detail' && !isFocus ? hiddenKidCount(node.id) : 0;
    const label = isFocus
      ? <><div className="node-title">{node.label}</div><div className="node-summary">{node.summary}</div></>
      : level === 'detail'
        // detail pill: title + its FULL summary (+ "N more ›" if it has sub-details to click into)
        ? <>
            <div className="detail-title">{node.label}</div>
            <div className="detail-summary">{node.summary}</div>
            {more > 0 && <div className="more-count">{more} more ›</div>}
          </>
        : node.label;

    // Dot only on main points (not while you're zoomed into it).
    const hasUnread = level === 'point' && !isFocus && unread.has(node.id);
    const clickable = !isFocus && hasKids(node.id) && level !== 'main';

    const dragging = dragPos?.id === node.id;
    const lineSides = sidesFor(node);

    return {
      id: node.id,
      position: dragging ? { x: dragPos.x, y: dragPos.y } : (positions.get(node.id) ?? { x: 0, y: 0 }),
      measured: measured[node.id],   // size React Flow measured (see handleNodesChange)
      data: { label },
      className: `shape-${level}${isFocus ? ' is-focus' : ''}${hasUnread ? ' has-unread' : ''}${clickable && level === 'detail' ? ' has-kids' : ''}`
        + `${node.id === dropTargetId ? ' drop-target' : ''}${editMode && node.id === editingId ? ' edit-selected' : ''}`,   // <- picks the shape
      selected: node.id === selectedNodeId,                         // Micah: highlight the box shown in the details panel
      draggable: editMode,                      // the main idea stays put
      ariaLabel: node.label + (hasUnread ? ', has new updates' : '') + ', importance ' + node.importance + ' out of 5.'
        + (editMode ? ' Edit mode: select to rename or delete.' : ' Select to open.'),
      sourcePosition: lineSides.source,
      targetPosition: lineSides.target,
    };
  });

  // Click a box that has children -> zoom in on it (main points AND deeper details).
  // Keep clicking to keep going deeper. Works from the Show all view too.
  function handleNodeClick(event, node) {
    const clicked = allNodes.find(n => n.id === node.id);
    if (editMode) { openEditor(clicked); return; }   // edit mode: click = open the edit panel
    onSelectNode?.(clicked);
    // Micah's details panel still opens from the topic list view.
    // Main points ALWAYS open (even with no details yet: you still see their summary card).
    // Deeper boxes open when they have their own sub-details.
    const isMainPoint = rootIds.has(clicked.parentId);
    if (clicked.parentId !== null && clicked.id !== focusId && (isMainPoint || hasKids(clicked.id))) {
      setFocusId(clicked.id);
      setShowAll(false);
    }
    markRead([clicked.id]);   // you looked at it, so its dot goes away
  }

  // Go up ONE level: from a sub-detail back to its detail, from a main point back to the big picture.
  function goUp() {
    if (!focusId) return;
    markRead([focusId]);
    const parentId = allNodes.find(node => node.id === focusId)?.parentId;
    setFocusId(parentId && !rootIds.has(parentId) ? parentId : null);
  }

  // Click empty space -> up one level (does nothing in the big picture / Show all).
  // In edit mode it just closes the edit panel.
  function handlePaneClick() {
    if (editMode) { setEditingId(null); return; }
    goUp();
  }

  function toggleEditMode() {
    setEditMode(current => !current);
    setEditingId(null);
    setEditMessage(null);
    setDragPos(null);
    setDropTargetId(null);
  }

  // Path from the main idea down to where you are, e.g. "Hackathon Plan › Tech Stack › OpenAI"
  const path = [];
  for (let id = focusId; id; id = allNodes.find(node => node.id === id)?.parentId) {
    const node = allNodes.find(n => n.id === id);
    if (!node) break;
    path.unshift(node.label);
  }

  // Show all on/off. Turning it on from a zoomed-in point goes back out first.
  function toggleShowAll() {
    if (focusId) markRead([focusId]);
    setFocusId(null);
    setShowAll(current => !current);
  }

  return (
    <div
      className={`mindmap mindmap-${mapStyle}${compact ? ' mindmap-outline' : ''}${editMode ? ' editing' : ''}`}
      /* size, border and colors come from mindmap.css (theme-aware) */
    >
      <ReactFlow
        key={mapStyle + '|' + (fullView ? 'all|' : '') + nodes.map(node => node.id).join('|')}
        nodes={flowNodes}
        edges={edges}
        nodesDraggable={editMode}
        nodesConnectable={editMode}
        edgesReconnectable={false}
        deleteKeyCode={null}
        fitView
        fitViewOptions={{ maxZoom: 1 }}
        minZoom={0.1}
        defaultEdgeOptions={{ type: sides.edgeType }}
        onNodesChange={handleNodesChange}
        onNodeDragStart={handleNodeDragStart}
        onNodeDragStop={handleNodeDragStop}
        onConnect={handleConnect}
        onNodeClick={handleNodeClick}
        onPaneClick={handlePaneClick}
      >
        <AutoFit shape={mapStyle + '|' + (fullView ? 'all' : top) + '|' + allNodes.map(n => n.id + ':' + n.parentId).join(',')
          + '|' + nodes.map(n => Math.round(measured[n.id]?.height ?? 0)).join(',')} />
        {editMode && (
          <Panel position="bottom-center">
            <div className="edit-hint" role="status">
              {editMessage
                ? <span className="edit-error">{editMessage}</span>
                : editNotice
                  ? editNotice
                  : 'Drag onto a box to move it inside · Drag to empty space to move it out · Click a box to edit'}
              {onEditingChange && (
                <div className="edit-paused">
                  Live map updates paused while you edit. Recording continues
                  {pendingCount > 0 ? ` · ${pendingCount} new line${pendingCount === 1 ? '' : 's'} waiting` : ''}.
                </div>
              )}
            </div>
          </Panel>
        )}
        {editingNode && (
          <Panel position="bottom-right">
            <form
              className="edit-panel nodrag nopan nowheel"
              aria-label={'Edit ' + editingNode.label}
              onSubmit={event => {
                event.preventDefault();
                tryEdit(state => editNode(state, editingNode.id, draft));
              }}
            >
              <label htmlFor="edit-node-title">Title</label>
              <input
                id="edit-node-title"
                value={draft.label}
                onChange={event => setDraft(current => ({ ...current, label: event.target.value }))}
              />
              <label htmlFor="edit-node-summary">Summary</label>
              <textarea
                id="edit-node-summary"
                rows={3}
                value={draft.summary}
                onChange={event => setDraft(current => ({ ...current, summary: event.target.value }))}
              />
              {!confirmDelete ? (
                <div className="edit-actions">
                  <button type="submit" className="edit-save">Save</button>
                  <button type="button" className="edit-delete" onClick={() => setConfirmDelete(true)}>Delete</button>
                  <button type="button" onClick={() => setEditingId(null)}>Close</button>
                </div>
              ) : (
                <div className="edit-confirm">
                  <p>
                    Delete “{editingNode.label}”
                    {editingBranchSize > 0 && ` and the ${editingBranchSize} topic${editingBranchSize === 1 ? '' : 's'} inside it`}?
                  </p>
                  <div className="edit-actions">
                    <button
                      type="button"
                      className="edit-delete"
                      onClick={() => { if (tryEdit(state => deleteNode(state, editingNode.id))) setEditingId(null); }}
                    >
                      Yes, delete
                    </button>
                    <button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button>
                  </div>
                </div>
              )}
              <label htmlFor="edit-parent">Move to</label>
              <select id="edit-parent" value={editingNode.parentId ?? ''} onChange={event => {
                const parentId = event.target.value || null;
                tryEdit(state => moveNode(state, editingNode.id, parentId));
              }}>
                <option value="">Independent tree</option>
                {allNodes.filter(node => !subtreeIds({ nodes: allNodes }, editingNode.id).has(node.id)).map(node => (
                  <option key={node.id} value={node.id}>{node.label}</option>
                ))}
              </select>
              <div className="edit-add">
                <label htmlFor="edit-node-add">Add a topic inside “{editingNode.label}”</label>
                <div className="edit-add-row">
                  <input
                    id="edit-node-add"
                    placeholder="Title (summary optional later)"
                    value={newTitle}
                    onChange={event => setNewTitle(event.target.value)}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addInside(editingNode); } }}
                  />
                  <button type="button" onClick={() => addInside(editingNode)}>Add</button>
                </div>
              </div>
            </form>
          </Panel>
        )}
        {focusId && (
          <Panel position="top-left">
            <div className="map-breadcrumb">
              <button type="button" onClick={goUp}>← Back</button>
              <span className="path" title={path.join(' › ')}>{path.join(' › ')}</span>
            </div>
          </Panel>
        )}
        <Panel position="top-right">
          <div className="map-controls">
            {onEdit && <button type="button" className="show-all-toggle" onClick={() => {
              const label = window.prompt('Name the new tree');
              if (label?.trim()) tryEdit(state => addNode(state, null, { label }));
            }}>New tree</button>}
            {onEdit && (
              <button
                type="button"
                className="show-all-toggle"
                aria-pressed={editMode}
                onClick={toggleEditMode}
              >
                {editMode ? 'Done editing' : 'Edit'}
              </button>
            )}
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
