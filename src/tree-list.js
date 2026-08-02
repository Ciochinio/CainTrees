// Nested collapsible list over the placement forest.

import { watchUrl } from './extract.js';
import { buildForest } from './placements.js';

const DEPTH_COLORS = [
  'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  'bg-slate-500/15 text-slate-300 ring-slate-500/30',
];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function titleOf(node) {
  if (!node) return 'Unknown video';
  if (node.video) return node.video.title;
  return node.unavailable ? 'Unavailable video' : node.id;
}

function badge(depth) {
  const color = DEPTH_COLORS[Math.min(depth - 1, DEPTH_COLORS.length - 1)];
  return el('span', `shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ${color}`, `d${depth}`);
}

/** Scroll to some occurrence of a video, opening whatever hides it. */
function jumpToVideo(videoId) {
  const target = document.querySelector(`[data-video-id="${CSS.escape(videoId)}"]`);
  if (!target) return;
  for (let p = target.parentElement; p; p = p.parentElement) {
    if (p.dataset.children === 'true' || p.dataset.unlinkedList) p.classList.remove('hidden');
    const toggle = p.previousElementSibling?.querySelector('button[aria-expanded]');
    if (toggle) {
      toggle.textContent = '▾';
      toggle.setAttribute('aria-expanded', 'true');
    }
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('ring-2', 'ring-sky-400');
  setTimeout(() => target.classList.remove('ring-2', 'ring-sky-400'), 1500);
}

function jumpChip(tree, videoId, glyph, tip) {
  const chip = el(
    'button',
    'max-w-[16rem] truncate rounded bg-slate-700/50 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-600/60',
    `${glyph} ${titleOf(tree.nodes.get(videoId))}`,
  );
  chip.title = tip;
  chip.addEventListener('click', () => jumpToVideo(videoId));
  return chip;
}

function meta(placement, node, tree) {
  const row = el('div', 'mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400');
  row.append(badge(placement.depth));

  if (node?.offChannel) {
    row.append(el('span', 'rounded bg-slate-700/60 px-1.5 py-0.5 text-[11px] text-slate-300', 'off-channel'));
  }
  if (node?.video?.channelTitle) row.append(el('span', 'truncate', node.video.channelTitle));
  if (placement.children.length) row.append(el('span', '', `${placement.children.length} linked`));
  if (node?.notFollowed) row.append(el('span', 'text-slate-500', `+${node.notFollowed} not followed`));
  if (node?.unavailable) row.append(el('span', 'text-rose-400/80', 'private, deleted, or not found'));

  // How many places this same video shows up — the reason it's worth repeating.
  if (node && node.incoming.length > 1) {
    const chip = el(
      'button',
      'rounded bg-violet-500/15 px-1.5 py-0.5 text-[11px] text-violet-300 hover:bg-violet-500/25',
      `linked from ${node.incoming.length}`,
    );
    chip.title = node.incoming.map((id) => titleOf(tree.nodes.get(id))).join('\n');
    chip.addEventListener('click', () => jumpToVideo(node.incoming[0]));
    row.append(chip);
  }

  if (placement.cyclic) {
    row.append(el('span', 'text-amber-400/80', '↺ already higher up this chain'));
  }
  return row;
}

export function renderPlacement(placement, tree) {
  const node = tree.nodes.get(placement.id);
  const li = el('li', 'relative');

  const row = el('div', 'group flex items-start gap-2 rounded-lg p-1.5 transition-colors hover:bg-slate-800/60');
  row.id = `node-${placement.key}`;
  row.dataset.videoId = placement.id;

  const toggle = el('button', 'mt-1 h-5 w-5 shrink-0 rounded text-slate-400 hover:bg-slate-700 hover:text-slate-100');
  if (placement.children.length) {
    toggle.textContent = '▾';
    toggle.setAttribute('aria-expanded', 'true');
  } else {
    toggle.className += ' invisible';
  }
  row.append(toggle);

  const thumbLink = el('a', 'block shrink-0 overflow-hidden rounded bg-slate-800');
  thumbLink.href = watchUrl(placement.id);
  thumbLink.target = '_blank';
  thumbLink.rel = 'noopener';
  if (node?.video?.thumb) {
    const img = el('img', 'h-12 w-[5.3rem] object-cover');
    img.loading = 'lazy';
    img.alt = '';
    img.src = node.video.thumb;
    thumbLink.append(img);
  } else {
    thumbLink.append(el('span', 'block h-12 w-[5.3rem] bg-slate-800'));
  }
  row.append(thumbLink);

  const body = el('div', 'min-w-0 flex-1');
  const title = el(
    'a',
    `block truncate text-sm font-medium ${
      node?.unavailable ? 'text-slate-500 italic' : 'text-slate-100 hover:text-sky-300'
    }`,
    titleOf(node),
  );
  title.href = watchUrl(placement.id);
  title.target = '_blank';
  title.rel = 'noopener';
  title.title = titleOf(node);
  body.append(title, meta(placement, node, tree));
  row.append(body);
  li.append(row);

  if (placement.children.length) {
    const children = el('ul', 'ml-3 space-y-0.5 border-l border-slate-700/70 pl-3');
    children.dataset.children = 'true';
    for (const child of placement.children) children.append(renderPlacement(child, tree));
    li.append(children);
    toggle.addEventListener('click', () => {
      const collapsed = children.classList.toggle('hidden');
      toggle.textContent = collapsed ? '▸' : '▾';
      toggle.setAttribute('aria-expanded', String(!collapsed));
    });
  }
  return li;
}

export function renderList(container, tree, forest) {
  container.replaceChildren();
  const roots = forest || buildForest(tree, startsOf(tree)).roots;

  const ul = el('ul', 'space-y-0.5');
  for (const placement of roots) ul.append(renderPlacement(placement, tree));
  container.append(ul);

  const isolated = tree.isolatedIds || [];
  if (!isolated.length) return;

  // Kept reachable, but out of the way: these link to nothing and nothing links
  // to them, so they'd otherwise be most of the rows on screen.
  const section = el('div', 'mt-4 border-t border-slate-800 pt-3');
  const toggle = el(
    'button',
    'flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs font-medium text-slate-400 hover:bg-slate-800/60',
  );
  const caret = el('span', 'text-slate-500', '▸');
  toggle.append(caret, el('span', '', `Unlinked videos (${isolated.length})`));

  const list = el('ul', 'mt-1 hidden space-y-0.5');
  list.dataset.unlinkedList = 'true';
  for (const id of isolated) {
    list.append(renderPlacement({ key: id, id, depth: 1, children: [], cyclic: false, size: 1 }, tree));
  }
  toggle.addEventListener('click', () => {
    const hidden = list.classList.toggle('hidden');
    caret.textContent = hidden ? '▸' : '▾';
  });
  section.append(toggle, list);
  container.append(section);
}

/** Videos nothing else in the set links to — where the forest starts. */
export function startsOf(tree) {
  const root = tree.nodes.get(tree.rootId);
  if (!root) return [];
  return root.isChannel ? root.childIds : [tree.rootId];
}

/**
 * Show only rows whose video satisfies `predicate`, keeping the ancestors of
 * every hit so the path stays readable. Pass null to clear. Returns the number
 * of distinct videos matched.
 */
export function filterList(container, tree, predicate) {
  const rows = container.querySelectorAll('[data-video-id]');
  const section = container.querySelector('[data-unlinked-list]');
  const matched = new Set();

  for (const row of rows) {
    const li = row.parentElement;
    if (!predicate) {
      li.classList.remove('hidden');
      row.classList.remove('ring-1', 'ring-sky-500/60');
      continue;
    }
    const node = tree.nodes.get(row.dataset.videoId);
    const hit = !!node && predicate(node);
    if (hit) matched.add(row.dataset.videoId);
    row.classList.toggle('ring-1', hit);
    row.classList.toggle('ring-sky-500/60', hit);
    li.classList.toggle('hidden', !hit);
  }

  if (!predicate) {
    if (section) {
      section.classList.add('hidden');
      const caret = section.previousElementSibling?.querySelector('span');
      if (caret) caret.textContent = '▸';
    }
    return 0;
  }

  for (const row of rows) {
    if (row.parentElement.classList.contains('hidden')) continue;
    for (let node = row.parentElement; node && node !== container; node = node.parentElement) {
      node.classList.remove('hidden');
    }
  }
  return matched.size;
}

export function setAllExpanded(container, expanded) {
  for (const ul of container.querySelectorAll('[data-children="true"]')) {
    ul.classList.toggle('hidden', !expanded);
  }
  for (const button of container.querySelectorAll('button[aria-expanded]')) {
    button.textContent = expanded ? '▾' : '▸';
    button.setAttribute('aria-expanded', String(expanded));
  }
}
