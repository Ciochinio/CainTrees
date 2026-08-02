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
      pos.set(placement.id, { x, y });
      return y;
    }
    const ys = placement.children.map(place);
    const y = (ys[0] + ys[ys.length - 1]) / 2;
    pos.set(placement.id, { x, y });
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
  // Edges can run either way in the neighbourhood view, so pick the sides.
  const rightwards = to.x >= from.x;
  const x1 = rightwards ? from.x + NODE_W : from.x;
  const y1 = from.y + NODE_H / 2;
  const x2 = rightwards ? to.x : to.x + NODE_W;
  const y2 = to.y + NODE_H / 2;
  const bend = Math.max(30, Math.abs(x2 - x1) / 2) * (rightwards ? 1 : -1);
  return svg('path', {
    d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
    fill: 'none',
    stroke: '#334155',
    'stroke-width': 1.5,
    'marker-end': 'url(#arrow)',
  });
}

/** Columns left-to-right by signed distance, each stack vertically centred. */
function layoutNeighbourhood(hood) {
  const indices = [...hood.columns.keys()].sort((a, b) => a - b);
  const tallest = Math.max(...indices.map((i) => hood.columns.get(i).length));
  const pos = new Map();

  indices.forEach((index, order) => {
    const ids = hood.columns.get(index);
    const offset = ((tallest - ids.length) * ROW) / 2;
    ids.forEach((id, row) => {
      pos.set(id, { x: order * COLUMN, y: offset + row * ROW });
    });
  });

  let width = 0;
  let height = 0;
  for (const { x, y } of pos.values()) {
    width = Math.max(width, x + NODE_W);
    height = Math.max(height, y + NODE_H);
  }
  return { pos, width, height };
}

function nodeGroup(placement, node, at, onSelect) {
  const group = svg('g', { transform: `translate(${at.x} ${at.y})`, class: 'cursor-pointer' });
  group.dataset.videoId = placement.id;

  // The node's face is a real SVG link, so middle-click, ⌘/Ctrl-click and the
  // right-click menu all open the video the way they do anywhere else. A plain
  // left click is intercepted below and opens the detail panel instead.
  const link = svg('a', { href: watchUrl(placement.id), target: '_blank', rel: 'noopener' });
  group.append(link);

  let stroke = DEPTH_STROKE[Math.min(placement.depth - 1, DEPTH_STROKE.length - 1)];
  if (node?.unavailable) stroke = '#7f1d1d';
  else if (node?.offChannel) stroke = '#475569';
  if (placement.isCentre) stroke = '#e2e8f0';

  const hub = placement.extraParents.length > 0;
  link.append(
    svg('rect', {
      width: NODE_W,
      height: NODE_H,
      rx: 10,
      fill: placement.isCentre ? '#1e293b' : '#0f172a',
      stroke,
      'stroke-width': placement.isCentre || hub ? 2 : 1,
      ...(node?.offChannel ? { 'stroke-dasharray': '5 3' } : {}),
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
  link.append(title);

  const bits = [];
  if (node?.offChannel) bits.push('off-channel');
  if (placement.incomingCount != null) {
    // Neighbourhood view: say how connected each video is, both directions.
    if (placement.incomingCount) bits.push(`${placement.incomingCount} in`);
    if (placement.outgoingCount) bits.push(`${placement.outgoingCount} out`);
  } else {
    if (hub) bits.push(`+${placement.extraParents.length} link here`);
    else if (node?.video?.channelTitle) bits.push(clip(node.video.channelTitle, 20));
    if (placement.children.length) bits.push(`${placement.children.length} linked`);
    if (placement.offTopic?.length) bits.push(`${placement.offTopic.length} outside`);
  }

  const sub = svg('text', { x: 12, y: 40, fill: hub ? '#c4b5fd' : '#94a3b8', 'font-size': 11 });
  sub.textContent = bits.join('  ·  ');
  link.append(sub);

  const full = svg('title');
  full.textContent = `${label}${
    node?.video?.channelTitle ? `\n${node.video.channelTitle}` : ''
  }\n\nClick for details · middle-click to watch`;
  group.append(full);

  link.addEventListener('click', (event) => {
    // Let the browser do its normal thing for modified and non-left clicks.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onSelect(placement);
  });
  return group;
}

export function renderGraph(container, tree, options = {}) {
  const { roots = [], hood = null, onSelect = () => {}, predicate = null } = options;

  container.replaceChildren();
  container.__fitObserver?.disconnect();
  container.__fitObserver = null;
  if (!roots.length && !hood) {
    return { fit() {}, zoomBy() {}, highlight: () => 0, select: () => false, size: 0 };
  }

  const { pos, width, height } = hood ? layoutNeighbourhood(hood) : layout(roots);

  const root = svg('svg', { width: '100%', height: '100%', class: 'block touch-none select-none' });
  const defs = svg('defs');
  const marker = svg('marker', {
    id: 'arrow',
    viewBox: '0 0 8 8',
    refX: 7,
    refY: 4,
    markerWidth: 5,
    markerHeight: 5,
    orient: 'auto-start-reverse',
  });
  marker.append(svg('path', { d: 'M 0 1 L 7 4 L 0 7 z', fill: '#475569' }));
  defs.append(marker);

  const camera = svg('g');
  const edges = svg('g');
  const nodes = svg('g');
  camera.append(edges, nodes);
  root.append(defs, camera);

  let drawn = 0;
  if (hood) {
    for (const [fromId, toId] of hood.edges) {
      const from = pos.get(fromId);
      const to = pos.get(toId);
      if (from && to) edges.append(edgePath(from, to));
    }
    for (const [id, at] of pos) {
      nodes.append(
        nodeGroup(
          {
            id,
            depth: Math.abs(hood.column.get(id)) + 1,
            children: [],
            extraParents: [],
            offTopic: [],
            isCentre: id === hood.centreId,
            incomingCount: (tree.nodes.get(id)?.incoming || []).length,
            outgoingCount: (tree.nodes.get(id)?.links || []).length,
          },
          tree.nodes.get(id),
          at,
          onSelect,
        ),
      );
      drawn++;
    }
  } else {
    const visit = (placement) => {
      const from = pos.get(placement.id);
      if (!from) return;
      for (const child of placement.children) {
        const to = pos.get(child.id);
        if (to) edges.append(edgePath(from, to));
        visit(child);
      }
      nodes.append(nodeGroup(placement, tree.nodes.get(placement.id), from, onSelect));
      drawn++;
    };
    roots.forEach(visit);
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

  // Panning must not eat clicks. Capture is taken only once the pointer has
  // actually travelled: grabbing it on every pointerdown re-targets the
  // following click at the <svg>, so node clicks never fired at all.
  const DRAG_THRESHOLD = 5;
  let down = null;
  let dragging = false;
  let suppressClick = false;

  root.addEventListener('pointerdown', (event) => {
    down = { x: event.clientX, y: event.clientY, tx, ty, id: event.pointerId };
    dragging = false;
  });
  root.addEventListener('pointermove', (event) => {
    if (!down) return;
    const dx = event.clientX - down.x;
    const dy = event.clientY - down.y;
    if (!dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      dragging = true;
      try {
        root.setPointerCapture(down.id);
      } catch {
        /* capture is a nicety; panning still works without it */
      }
      root.classList.add('cursor-grabbing');
    }
    tx = down.tx + dx;
    ty = down.ty + dy;
    apply();
  });
  const endDrag = () => {
    if (dragging) {
      suppressClick = true; // a pan that ends on a node shouldn't select it
      try {
        root.releasePointerCapture(down.id);
      } catch {
        /* already released */
      }
    }
    dragging = false;
    down = null;
    root.classList.remove('cursor-grabbing');
  };
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
  root.addEventListener(
    'click',
    (event) => {
      if (!suppressClick) return;
      event.stopPropagation();
      suppressClick = false;
    },
    true,
  );

  /** Ring a node and bring it to the middle — used when arriving from a link. */
  const select = (videoId) => {
    let found = null;
    for (const group of nodes.children) {
      const isIt = group.dataset.videoId === videoId;
      const rect = group.querySelector('rect');
      rect.setAttribute('stroke-width', isIt ? 3 : rect.dataset.baseWidth || 1);
      if (isIt) found = group;
    }
    if (!found) return false;
    const parts = found.getAttribute('transform').match(/-?[\d.]+/g) || [0, 0];
    const box = container.getBoundingClientRect();
    tx = box.width / 2 - (Number(parts[0]) + NODE_W / 2) * scale;
    ty = box.height / 2 - (Number(parts[1]) + NODE_H / 2) * scale;
    apply();
    return true;
  };
  for (const group of nodes.children) {
    const rect = group.querySelector('rect');
    rect.dataset.baseWidth = rect.getAttribute('stroke-width');
  }

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

  return { fit, zoomBy, highlight, select, size: drawn };
}
