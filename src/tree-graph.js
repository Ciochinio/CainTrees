// Graph view over the placement forest: a tidy tree, so every edge is a short
// hop from a parent to its own child. A video linked by several others is drawn
// once per linker rather than once with edges reaching across the canvas.

import { watchUrl } from './extract.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_W = 210;
const NODE_H = 54;
const X_GAP = 70;
const Y_GAP = 14;
const ROW = NODE_H + Y_GAP;
const COLUMN = NODE_W + X_GAP;
const TREE_GAP = 28; // breathing room between separate root chains

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

/** Leaves take the next free row; parents centre on the span of their children. */
function layout(roots) {
  const pos = new Map();
  let cursor = 0;

  const place = (placement) => {
    const x = (placement.depth - 1) * COLUMN;
    if (!placement.children.length) {
      const y = cursor++ * ROW;
      pos.set(placement.key, { x, y });
      return y;
    }
    const ys = placement.children.map(place);
    const y = (ys[0] + ys[ys.length - 1]) / 2;
    pos.set(placement.key, { x, y });
    return y;
  };

  for (const root of roots) {
    place(root);
    cursor += TREE_GAP / ROW; // a visible gap between top-level chains
  }

  let width = 0;
  let height = 0;
  for (const { x, y } of pos.values()) {
    width = Math.max(width, x + NODE_W);
    height = Math.max(height, y + NODE_H);
  }
  return { pos, width, height };
}

function edgePath(from, to) {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const bend = Math.max(30, (x2 - x1) / 2);
  return svg('path', {
    d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
    fill: 'none',
    stroke: '#334155',
    'stroke-width': 1.5,
  });
}

function nodeGroup(placement, node, at, onFocus) {
  const group = svg('g', { transform: `translate(${at.x} ${at.y})`, class: 'cursor-pointer' });
  group.dataset.videoId = placement.id;

  let stroke = DEPTH_STROKE[Math.min(placement.depth - 1, DEPTH_STROKE.length - 1)];
  if (node?.unavailable) stroke = '#7f1d1d';
  else if (node?.offChannel) stroke = '#475569';
  else if (placement.cyclic) stroke = '#f59e0b';

  const repeated = node && node.incoming.length > 1;
  group.append(
    svg('rect', {
      width: NODE_W,
      height: NODE_H,
      rx: 10,
      fill: '#0f172a',
      stroke,
      'stroke-width': repeated ? 2 : 1,
      ...(node?.offChannel || placement.cyclic ? { 'stroke-dasharray': '5 3' } : {}),
    }),
  );

  const label = node?.video ? node.video.title : node?.unavailable ? 'Unavailable video' : placement.id;
  const title = svg('text', {
    x: 12,
    y: 22,
    fill: node?.unavailable ? '#64748b' : '#e2e8f0',
    'font-size': 12.5,
  });
  title.textContent = clip(label, 28);
  group.append(title);

  const bits = [];
  if (node?.offChannel) bits.push('off-channel');
  if (placement.cyclic) bits.push('loops back');
  if (repeated) bits.push(`linked from ${node.incoming.length}`);
  else if (node?.video?.channelTitle) bits.push(clip(node.video.channelTitle, 20));
  if (placement.children.length) bits.push(`${placement.children.length} linked`);

  const sub = svg('text', { x: 12, y: 40, fill: repeated ? '#c4b5fd' : '#94a3b8', 'font-size': 11 });
  sub.textContent = bits.join('  ·  ');
  group.append(sub);

  const canFocus = placement.children.length > 0;
  const full = svg('title');
  full.textContent = `${label}${node?.video?.channelTitle ? `\n${node.video.channelTitle}` : ''}\n\n${
    canFocus ? 'Click to focus · ⌘/Ctrl-click to open on YouTube' : 'Click to open on YouTube'
  }`;
  group.append(full);

  group.addEventListener('click', (event) => {
    if (canFocus && !event.metaKey && !event.ctrlKey) onFocus(placement);
    else window.open(watchUrl(placement.id), '_blank', 'noopener');
  });
  return group;
}

export function renderGraph(container, tree, options = {}) {
  const { roots = [], onFocus = () => {}, predicate = null } = options;

  container.replaceChildren();
  container.__fitObserver?.disconnect();
  container.__fitObserver = null;
  if (!roots.length) return { fit() {}, zoomBy() {}, highlight: () => 0, size: 0 };

  const { pos, width, height } = layout(roots);

  const root = svg('svg', { width: '100%', height: '100%', class: 'block touch-none select-none' });
  const camera = svg('g');
  const edges = svg('g');
  const nodes = svg('g');
  camera.append(edges, nodes);
  root.append(camera);

  let drawn = 0;
  const visit = (placement) => {
    const from = pos.get(placement.key);
    if (!from) return;
    for (const child of placement.children) {
      const to = pos.get(child.key);
      if (to) edges.append(edgePath(from, to));
      visit(child);
    }
    nodes.append(nodeGroup(placement, tree.nodes.get(placement.id), from, onFocus));
    drawn++;
  };
  roots.forEach(visit);

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

  const highlight = (test) => {
    const groups = [...nodes.children];
    if (!test) {
      for (const group of groups) group.setAttribute('opacity', 1);
      return 0;
    }
    let first = null;
    const matched = new Set();
    for (const group of groups) {
      const node = tree.nodes.get(group.dataset.videoId);
      const hit = !!node && test(node);
      group.setAttribute('opacity', hit ? 1 : 0.15);
      if (hit) {
        matched.add(group.dataset.videoId);
        if (!first) first = group;
      }
    }
    if (first) {
      const box = container.getBoundingClientRect();
      const parts = first.getAttribute('transform').match(/-?[\d.]+/g) || [0, 0];
      tx = box.width / 2 - (Number(parts[0]) + NODE_W / 2) * scale;
      ty = box.height / 2 - (Number(parts[1]) + NODE_H / 2) * scale;
      apply();
    }
    return matched.size;
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
    const observer = new ResizeObserver(() => {
      if (fitted) return observer.disconnect();
      fit(true);
    });
    observer.observe(container);
    container.__fitObserver = observer;
  }

  return { fit, zoomBy, highlight, size: drawn };
}
