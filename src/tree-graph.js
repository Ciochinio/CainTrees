// SVG node-link view: hand-rolled layout, pan and zoom, no dependencies.

import { watchUrl } from './extract.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_W = 210;
const NODE_H = 54;
const X_GAP = 70;
const Y_GAP = 14;
const ROW = NODE_H + Y_GAP;

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

/**
 * One post-order pass: leaves take the next free row, parents centre on the
 * span of their children. Enough for the shallow, wide trees we produce.
 */
function layout(tree, rootId) {
  const pos = new Map();
  const baseDepth = tree.nodes.get(rootId).depth;
  let cursor = 0;

  const place = (id) => {
    const node = tree.nodes.get(id);
    const x = (node.depth - baseDepth) * (NODE_W + X_GAP);
    const kids = node.childIds.filter((childId) => tree.nodes.has(childId));
    if (!kids.length) {
      const y = cursor++ * ROW;
      pos.set(id, { x, y });
      return y;
    }
    const ys = kids.map(place);
    const y = (ys[0] + ys[ys.length - 1]) / 2;
    pos.set(id, { x, y });
    return y;
  };

  place(rootId);

  let maxX = 0;
  let maxY = 0;
  for (const { x, y } of pos.values()) {
    maxX = Math.max(maxX, x + NODE_W);
    maxY = Math.max(maxY, y + NODE_H);
  }
  return { pos, width: maxX, height: maxY };
}

function edgePath(from, to, dashed) {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const bend = Math.max(30, (x2 - x1) / 2);
  return svg('path', {
    d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
    fill: 'none',
    stroke: dashed ? '#475569' : '#334155',
    'stroke-width': dashed ? 1 : 1.5,
    ...(dashed ? { 'stroke-dasharray': '4 4' } : {}),
  });
}

function nodeGroup(node, at, onFocus) {
  const group = svg('g', {
    transform: `translate(${at.x} ${at.y})`,
    class: 'cursor-pointer',
  });
  group.dataset.nodeId = node.id;

  let stroke = DEPTH_STROKE[Math.min(node.depth, DEPTH_STROKE.length - 1)];
  if (node.unavailable) stroke = '#7f1d1d';
  else if (node.offChannel) stroke = '#475569';

  group.append(
    svg('rect', {
      width: NODE_W,
      height: NODE_H,
      rx: 10,
      fill: node.depth === 0 ? '#1e293b' : '#0f172a',
      stroke,
      'stroke-width': node.depth === 0 ? 2 : 1,
      ...(node.offChannel ? { 'stroke-dasharray': '5 3' } : {}),
    }),
  );

  const label = node.isChannel
    ? node.channel.title
    : node.video
      ? node.video.title
      : node.unavailable
        ? 'Unavailable video'
        : node.id;

  const title = svg('text', { x: 12, y: 22, fill: node.unavailable ? '#64748b' : '#e2e8f0', 'font-size': 12.5 });
  title.textContent = clip(label, 28);
  group.append(title);

  const sub = svg('text', { x: 12, y: 40, fill: '#94a3b8', 'font-size': 11 });
  const bits = [];
  if (node.isChannel) bits.push('channel');
  else if (node.offChannel) bits.push('off-channel');
  if (node.video?.channelTitle) bits.push(clip(node.video.channelTitle, 20));
  if (node.childIds.length) bits.push(`${node.childIds.length} linked`);
  sub.textContent = bits.join('  ·  ');
  group.append(sub);

  const href = node.isChannel
    ? `https://www.youtube.com/channel/${node.channel.id}`
    : watchUrl(node.id);
  const canFocus = node.childIds.length > 0;

  const full = svg('title');
  full.textContent = `${node.video ? `${node.video.title}\n${node.video.channelTitle}` : label}\n\n${
    canFocus ? 'Click to focus · ⌘/Ctrl-click to open on YouTube' : 'Click to open on YouTube'
  }`;
  group.append(full);

  group.addEventListener('click', (event) => {
    // Drilling in is the common action on a node that has children; opening the
    // video is what you want on a leaf.
    if (canFocus && !event.metaKey && !event.ctrlKey) onFocus(node.id);
    else window.open(href, '_blank', 'noopener');
  });
  return group;
}

/**
 * Draws the tree into `container` and returns a controller with `fit()`.
 */
export function renderGraph(container, tree, options = {}) {
  const { rootId = tree.rootId, showCrossLinks = false, onFocus = () => {} } = options;

  container.replaceChildren();
  // Any pending re-fit belongs to the graph we just discarded.
  container.__fitObserver?.disconnect();
  container.__fitObserver = null;
  if (!tree.nodes.has(rootId)) return { fit() {}, zoomBy() {}, highlight() {} };

  const { pos, width, height } = layout(tree, rootId);

  const root = svg('svg', { width: '100%', height: '100%', class: 'block touch-none select-none' });
  const camera = svg('g');
  const edges = svg('g');
  const nodes = svg('g');
  camera.append(edges, nodes);
  root.append(camera);

  for (const node of tree.nodes.values()) {
    const from = pos.get(node.id);
    if (!from) continue;
    for (const childId of node.childIds) {
      const to = pos.get(childId);
      if (to) edges.append(edgePath(from, to, false));
    }
    if (showCrossLinks) {
      for (const targetId of node.crossLinks) {
        const to = pos.get(targetId);
        if (to) edges.append(edgePath(from, to, true));
      }
    }
    nodes.append(nodeGroup(node, from, onFocus));
  }

  container.append(root);

  let scale = 1;
  let tx = 0;
  let ty = 0;
  const apply = () => camera.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`);

  const zoomAbout = (next, mx, my) => {
    const clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, next));
    tx = mx - ((mx - tx) * clamped) / scale;
    ty = my - ((my - ty) * clamped) / scale;
    scale = clamped;
    apply();
  };

  // True once the graph has been fitted against a container that actually had a
  // size — rendering into a hidden pane otherwise leaves a junk transform.
  let fitted = false;

  /**
   * `respectFloor` is for the automatic fit on render: a wide tree would shrink
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

  root.addEventListener('wheel', (event) => {
    event.preventDefault();
    const box = root.getBoundingClientRect();
    zoomAbout(
      scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12),
      event.clientX - box.left,
      event.clientY - box.top,
    );
  }, { passive: false });

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

  /**
   * Dim everything that doesn't match, and centre the first hit. Returns the
   * number of matches so the caller can report "no results".
   */
  const highlight = (query) => {
    const needle = String(query || '').trim().toLowerCase();
    const groups = [...nodes.children];
    if (!needle) {
      for (const group of groups) group.setAttribute('opacity', 1);
      return 0;
    }
    let first = null;
    let count = 0;
    for (const group of groups) {
      const node = tree.nodes.get(group.dataset.nodeId);
      const label = (node?.video?.title || node?.channel?.title || '').toLowerCase();
      const hit = label.includes(needle);
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

  return { fit, zoomBy, highlight };
}
