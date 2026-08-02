// Rows for the list view. One row per video — never the same video twice.

import { watchUrl } from './extract.js';

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

export function titleOf(node) {
  if (!node) return 'Unknown video';
  if (node.video) return node.video.title;
  return node.unavailable ? 'Unavailable video' : node.id;
}

function badge(depth) {
  const color = DEPTH_COLORS[Math.min(depth - 1, DEPTH_COLORS.length - 1)];
  return el('span', `shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ${color}`, `d${depth}`);
}

/** Scroll to a video wherever it is on the page, opening whatever hides it. */
export function jumpToVideo(videoId) {
  const target = document.querySelector(`[data-video-id="${CSS.escape(videoId)}"]`);
  if (!target) return false;
  for (let p = target.parentElement; p; p = p.parentElement) {
    if (p.dataset.children === 'true') p.classList.remove('hidden');
    const toggle = p.previousElementSibling?.querySelector('button[aria-expanded]');
    if (toggle) {
      toggle.textContent = '▾';
      toggle.setAttribute('aria-expanded', 'true');
    }
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('ring-2', 'ring-sky-400');
  setTimeout(() => target.classList.remove('ring-2', 'ring-sky-400'), 1500);
  return true;
}

function linkChip(tree, videoId, glyph, tip, onOpen) {
  const chip = el(
    'button',
    'max-w-[15rem] truncate rounded bg-slate-700/50 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-600/60',
    `${glyph} ${titleOf(tree.nodes.get(videoId))}`,
  );
  chip.title = tip;
  chip.addEventListener('click', (event) => {
    event.stopPropagation();
    onOpen(videoId);
  });
  return chip;
}

function meta(placement, node, tree, onOpen) {
  const row = el('div', 'mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400');
  row.append(badge(placement.depth));

  if (node?.offChannel) {
    row.append(el('span', 'rounded bg-slate-700/60 px-1.5 py-0.5 text-[11px] text-slate-300', 'off-channel'));
  }
  if (node?.video?.channelTitle) row.append(el('span', 'truncate', node.video.channelTitle));
  if (placement.children.length) row.append(el('span', '', `${placement.children.length} linked`));
  if (node?.unavailable) row.append(el('span', 'text-rose-400/80', 'private, deleted, or not found'));

  // Other videos here that also link to this one — the tree can only nest under
  // one of them, so the rest are named instead of redrawn.
  for (const sourceId of placement.extraParents) {
    row.append(linkChip(tree, sourceId, '←', 'Also links to this video', onOpen));
  }

  // Links leaving this topic. Shown, but never expanded inline — following one
  // moves you to a topic that contains it.
  if (placement.offTopic.length) {
    const label = el('span', 'text-slate-500', 'also links to');
    row.append(label);
    for (const targetId of placement.offTopic.slice(0, 2)) {
      row.append(linkChip(tree, targetId, '→', 'Outside this topic — jump to it', onOpen));
    }
    if (placement.offTopic.length > 2) {
      row.append(el('span', 'text-slate-500', `+${placement.offTopic.length - 2}`));
    }
  }
  return row;
}

export function renderPlacement(placement, tree, onOpen = () => {}) {
  const node = tree.nodes.get(placement.id);
  const li = el('li', 'relative');

  const row = el('div', 'group flex items-start gap-2 rounded-lg p-1.5 transition-colors hover:bg-slate-800/60');
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
  body.append(title, meta(placement, node, tree, onOpen));
  row.append(body);
  li.append(row);

  if (placement.children.length) {
    const children = el('ul', 'ml-3 space-y-0.5 border-l border-slate-700/70 pl-3');
    children.dataset.children = 'true';
    for (const child of placement.children) children.append(renderPlacement(child, tree, onOpen));
    li.append(children);
    toggle.addEventListener('click', () => {
      const collapsed = children.classList.toggle('hidden');
      toggle.textContent = collapsed ? '▸' : '▾';
      toggle.setAttribute('aria-expanded', String(!collapsed));
    });
  }
  return li;
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
