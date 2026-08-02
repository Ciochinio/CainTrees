// Graph view: a layered DAG. Every link is a real edge and each video is drawn
// once, so a video linked by twelve others shows twelve arrows arriving —
// nothing about the picture depends on the order videos were discovered.

import { watchUrl } from './extract.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_W = 210;
const NODE_H = 54;
const X_GAP = 70;
const Y_GAP = 14;
const ROW = NODE_H + Y_GAP;
const COLUMN = NODE_W + X_GAP;

const MIN_SCALE = 0.15;
const MAX_SCALE = 3;
const MIN_FIT_SCALE = 0.65; // below this the labels stop being readable

const DEPTH_STROKE = ['#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#94a3b8'];

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function clip(text, max) {
  const str = String(text || '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

/** Every node reachable from `startIds` by following links. */
export function collect(tree, startIds) {
  const seen = new Set();
  const queue = [...startIds];
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id) || !tree.nodes.has(id)) continue;
    seen.add(id);
    for (const target of tree.nodes.get(id).links) queue.push(target);
  }
  return seen;
}

/**
 * Layered layout over a subgraph.
 *
 * Columns come from the longest path to each node, so an edge always points
 * rightwards; links that close a cycle are reported separately and drawn as
 * back-edges. Rows are then ordered by the average position of each node's
 * neighbours — a couple of sweeps is enough to untangle most crossings.
 */
function layoutDag(tree, ids) {
  const out = new Map();
  const inn = new Map();
  for (const id of ids) {
    out.set(id, []);
    inn.set(id, []);
  }
  for (const id of ids) {
    for (const target of tree.nodes.get(id).links) {
      if (!ids.has(target)) continue;
      out.get(id).push(target);
      inn.get(target).push(id);
    }
  }

  // Depth-first sweep marking edges that point back at an ancestor.
  const backEdges = new Set();
  const state = new Map();
  for (const start of ids) {
    if (state.get(start)) continue;
    state.set(start, 1);
    const stack = [[start, 0]];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const targets = out.get(frame[0]);
      if (frame[1] >= targets.length) {
        state.set(frame[0], 2);
        stack.pop();
        continue;
      }
      const target = targets[frame[1]++];
      const seen = state.get(target) || 0;
      if (seen === 1) backEdges.add(`${frame[0]}>${target}`);
      else if (seen === 0) {
        state.set(target, 1);
        stack.push([target, 0]);
      }
    }
  }

  const forward = (from, to) => !backEdges.has(`${from}>${to}`);

  const indegree = new Map();
  for (const id of ids) indegree.set(id, 0);
  for (const id of ids) {
    for (const target of out.get(id)) {
      if (forward(id, target)) indegree.set(target, indegree.get(target) + 1);
    }
  }

  const column = new Map([...ids].map((id) => [id, 0]));
  const queue = [...ids].filter((id) => indegree.get(id) === 0);
  const ordered = [];
  while (queue.length) {
    const id = queue.shift();
    ordered.push(id);
    for (const target of out.get(id)) {
      if (!forward(id, target)) continue;
      column.set(target, Math.max(column.get(target), column.get(id) + 1));
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  for (const id of ids) if (!ordered.includes(id) && !column.has(id)) column.set(id, 0);

  const layers = [];
  for (const id of ordered) {
    const index = column.get(id);
    (layers[index] ||= []).push(id);
  }
  for (let i = 0; i < layers.length; i++) layers[i] ||= [];

  // Barycentre sweeps: put each node near the average row of its neighbours.
  const rowOf = new Map();
  const reindex = () => {
    for (const layer of layers) layer.forEach((id, index) => rowOf.set(id, index));
  };
  reindex();
  const barycentre = (id, neighbours) => {
    const rows = neighbours.get(id).map((other) => rowOf.get(other)).filter((r) => r != null);
    return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : rowOf.get(id);
  };
  for (let pass = 0; pass < 4; pass++) {
    const downward = pass % 2 === 0;
    const indices = layers.map((_, i) => i);
    for (const i of downward ? indices : indices.reverse()) {
      const neighbours = downward ? inn : out;
      layers[i] = [...layers[i]].sort((a, b) => barycentre(a, neighbours) - barycentre(b, neighbours));
      reindex();
    }
  }

  const pos = new Map();
  layers.forEach((layer, index) => {
    layer.forEach((id, row) => pos.set(id, { x: index * COLUMN, y: row * ROW }));
  });

  let width = 0;
  let height = 0;
  for (const { x, y } of pos.values()) {
    width = Math.max(width, x + NODE_W);
    height = Math.max(height, y + NODE_H);
  }
  return { pos, width, height, backEdges, column };
}

function edgePath(from, to, kind) {
  const forward = to.x > from.x;
  const x1 = forward ? from.x + NODE_W : from.x;
  const y1 = from.y + NODE_H / 2;
  const x2 = forward ? to.x : to.x + NODE_W;
  const y2 = to.y + NODE_H / 2;
  const bend = Math.max(30, Math.abs(x2 - x1) / 2);
  const dir = forward ? 1 : -1;
  return svg('path', {
    d: `M ${x1} ${y1} C ${x1 + bend * dir} ${y1}, ${x2 - bend * dir} ${y2}, ${x2} ${y2}`,
    fill: 'none',
    stroke: kind === 'back' ? '#7c3aed' : '#334155',
    'stroke-width': 1.5,
    ...(kind === 'back' ? { 'stroke-dasharray': '5 4' } : {}),
    'marker-end': 'url(#arrow)',
  });
}

function nodeGroup(node, at, column, onFocus) {
  const group = svg('g', { transform: `translate(${at.x} ${at.y})`, class: 'cursor-pointer' });
  group.dataset.nodeId = node.id;

  let stroke = DEPTH_STROKE[Math.min(column, DEPTH_STROKE.length - 1)];
  if (node.unavailable) stroke = '#7f1d1d';
  else if (node.offChannel) stroke = '#475569';

  const hub = node.incoming.length > 1;
  group.append(
    svg('rect', {
      width: NODE_W,
      height: NODE_H,
      rx: 10,
      fill: '#0f172a',
      stroke,
      'stroke-width': hub ? 2 : 1,
      ...(node.offChannel ? { 'stroke-dasharray': '5 3' } : {}),
    }),
  );

  const label = node.video ? node.video.title : node.unavailable ? 'Unavailable video' : node.id;
  const title = svg('text', {
    x: 12,
    y: 22,
    fill: node.unavailable ? '#64748b' : '#e2e8f0',
    'font-size': 12.5,
  });
  title.textContent = clip(label, 28);
  group.append(title);

  const bits = [];
  if (node.offChannel) bits.push('off-channel');
  if (node.incoming.length) bits.push(`${node.incoming.length} in`);
  if (node.links.length) bits.push(`${node.links.length} out`);
  const sub = svg('text', { x: 12, y: 40, fill: hub ? '#c4b5fd' : '#94a3b8', 'font-size': 11 });
  sub.textContent = bits.join('  ·  ');
  group.append(sub);

  const canFocus = node.links.length > 0;
  const full = svg('title');
  full.textContent = `${label}${node.video?.channelTitle ? `\n${node.video.channelTitle}` : ''}\n\n${
    canFocus ? 'Click to focus · ⌘/Ctrl-click to open on YouTube' : 'Click to open on YouTube'
  }`;
  group.append(full);

  group.addEventListener('click', (event) => {
    if (canFocus && !event.metaKey && !event.ctrlKey) onFocus(node.id);
    else window.open(watchUrl(node.id), '_blank', 'noopener');
  });
  return group;
}

/**
 * Draws the subgraph reachable from `startIds` and returns a controller.
 */
export function renderGraph(container, tree, options = {}) {
  const { startIds = [], onFocus = () => {}, predicate = null } = options;

  container.replaceChildren();
  container.__fitObserver?.disconnect();
  container.__fitObserver = null;

  const ids = collect(tree, startIds);
  if (!ids.size) return { fit() {}, zoomBy() {}, highlight: () => 0, size: 0 };

  const { pos, width, height, backEdges, column } = layoutDag(tree, ids);

  const root = svg('svg', { width: '100%', height: '100%', class: 'block touch-none select-none' });
  const defs = svg('defs');
  const marker = svg('marker', {
    id: 'arrow',
    viewBox: '0 0 8 8',
    refX: 7,
    refY: 4,
    markerWidth: 6,
    markerHeight: 6,
    orient: 'auto-start-reverse',
  });
  marker.append(svg('path', { d: 'M 0 1 L 7 4 L 0 7 z', fill: '#475569' }));
  defs.append(marker);

  const camera = svg('g');
  const edges = svg('g');
  const nodes = svg('g');
  camera.append(edges, nodes);
  root.append(defs, camera);

  for (const id of ids) {
    const node = tree.nodes.get(id);
    const from = pos.get(id);
    if (!from) continue;
    for (const target of node.links) {
      const to = pos.get(target);
      if (to) edges.append(edgePath(from, to, backEdges.has(`${id}>${target}`) ? 'back' : 'forward'));
    }
    nodes.append(nodeGroup(node, from, column.get(id) || 0, onFocus));
  }

  container.append(root);

  let scale = 1;
  let tx = 0;
  let ty = 0;
  let fitted = false;
  const apply = () => camera.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`);

  const zoomAbout = (next, mx, my) => {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    tx = mx - ((mx - tx) * clamped) / scale;
    ty = my - ((my - ty) * clamped) / scale;
    scale = clamped;
    apply();
  };

  /**
   * `respectFloor` is for the automatic fit on render: a wide graph would shrink
   * to unreadable to fit, and overflowing with pan is the better default. The
   * Fit-to-view button passes false, because there "fit" means the whole thing.
   */
  const fit = (respectFloor = false) => {
    const box = container.getBoundingClientRect();
    const pad = 24;
    if (box.width < pad * 2 || box.height < pad * 2) return;
    const ideal = Math.min(
      (box.width - pad * 2) / Math.max(width, 1),
      (box.height - pad * 2) / Math.max(height, 1),
      1,
    );
    const floor = respectFloor ? MIN_FIT_SCALE : MIN_SCALE;
    scale = Number.isFinite(ideal) && ideal > 0 ? Math.max(floor, ideal) : 1;
    tx = pad;
    ty = Math.max(pad, (box.height - height * scale) / 2);
    fitted = true;
    apply();
  };

  const zoomBy = (factor) => {
    const box = container.getBoundingClientRect();
    zoomAbout(scale * factor, box.width / 2, box.height / 2);
  };

  /**
   * Dim every node failing `predicate`, and centre the first hit. Pass null to
   * clear. Returns the number of matches so the caller can report "no results".
   */
  const highlight = (test) => {
    const groups = [...nodes.children];
    if (!test) {
      for (const group of groups) group.setAttribute('opacity', 1);
      return 0;
    }
    let first = null;
    let count = 0;
    for (const group of groups) {
      const node = tree.nodes.get(group.dataset.nodeId);
      const hit = !!node && test(node);
      group.setAttribute('opacity', hit ? 1 : 0.15);
      if (hit) {
        count++;
        if (!first) first = pos.get(node.id);
      }
    }
    if (first) {
      const box = container.getBoundingClientRect();
      tx = box.width / 2 - (first.x + NODE_W / 2) * scale;
      ty = box.height / 2 - (first.y + NODE_H / 2) * scale;
      apply();
    }
    return count;
  };

  root.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const box = root.getBoundingClientRect();
      zoomAbout(
        scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12),
        event.clientX - box.left,
        event.clientY - box.top,
      );
    },
    { passive: false },
  );

  let dragging = null;
  let dragDistance = 0;
  root.addEventListener('pointerdown', (event) => {
    dragging = { x: event.clientX - tx, y: event.clientY - ty };
    dragDistance = 0;
    root.setPointerCapture(event.pointerId);
    root.classList.add('cursor-grabbing');
  });
  root.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const nx = event.clientX - dragging.x;
    const ny = event.clientY - dragging.y;
    dragDistance += Math.abs(nx - tx) + Math.abs(ny - ty);
    tx = nx;
    ty = ny;
    apply();
  });
  // A pan that ends over a node shouldn't also open that video.
  root.addEventListener(
    'click',
    (event) => {
      if (dragDistance > 4) event.stopPropagation();
      dragDistance = 0;
    },
    true,
  );
  const endDrag = () => {
    dragging = null;
    root.classList.remove('cursor-grabbing');
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);

  if (predicate) highlight(predicate);
  fit(true);
  if (!fitted) {
    // The pane was hidden or zero-sized; fit as soon as it gets a real box.
    const observer = new ResizeObserver(() => {
      if (fitted) return observer.disconnect();
      fit(true);
    });
    observer.observe(container);
    container.__fitObserver = observer;
  }

  return { fit, zoomBy, highlight, size: ids.size };
}
