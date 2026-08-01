// Nested collapsible list view.

import { watchUrl } from './extract.js';

const CHANNEL_HOME = 'https://www.youtube.com/channel/';

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
  if (node.isChannel) return node.channel.title;
  if (node.video) return node.video.title;
  return node.unavailable ? 'Unavailable video' : node.id;
}

function linkOf(node) {
  return node.isChannel ? CHANNEL_HOME + node.channel.id : watchUrl(node.id);
}

function badge(node) {
  const color = DEPTH_COLORS[Math.min(node.depth, DEPTH_COLORS.length - 1)];
  return el('span', `shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ${color}`, `d${node.depth}`);
}

function meta(node, tree) {
  const row = el('div', 'mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400');
  if (node.isChannel) {
    row.append(el('span', '', `${node.childIds.length} videos nothing links to`));
    return row;
  }
  row.append(badge(node));
  if (node.offChannel) {
    row.append(
      el(
        'span',
        'rounded bg-slate-700/60 px-1.5 py-0.5 text-[11px] text-slate-300',
        'off-channel',
      ),
    );
  }
  if (node.video?.channelTitle) row.append(el('span', 'truncate', node.video.channelTitle));
  if (node.childIds.length) row.append(el('span', '', `${node.childIds.length} linked`));
  if (node.notFollowed) row.append(el('span', 'text-slate-500', `+${node.notFollowed} not followed`));
  if (node.unavailable) {
    row.append(el('span', 'text-rose-400/80', 'private, deleted, or not found'));
  }

  for (const targetId of node.crossLinks) {
    const target = tree.nodes.get(targetId);
    const chip = el(
      'button',
      'max-w-[16rem] truncate rounded bg-slate-700/50 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-600/60',
      `↩ ${target ? titleOf(target) : targetId}`,
    );
    chip.title = 'Already shown elsewhere in the tree — jump to it';
    chip.addEventListener('click', () => {
      const el2 = document.getElementById(`node-${targetId}`);
      if (!el2) return;
      // Make sure every collapsed ancestor is open before scrolling.
      for (let p = el2.parentElement; p; p = p.parentElement) {
        if (p.dataset.children !== 'true') continue;
        p.classList.remove('hidden');
        const toggle = p.previousElementSibling?.querySelector('button[aria-expanded]');
        if (toggle) {
          toggle.textContent = '▾';
          toggle.setAttribute('aria-expanded', 'true');
        }
      }
      el2.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el2.classList.add('ring-2', 'ring-sky-400');
      setTimeout(() => el2.classList.remove('ring-2', 'ring-sky-400'), 1500);
    });
    row.append(chip);
  }
  return row;
}

function renderNode(node, tree) {
  const li = el('li', 'relative');

  const row = el(
    'div',
    'group flex items-start gap-2 rounded-lg p-1.5 transition-colors hover:bg-slate-800/60',
  );
  row.id = `node-${node.id}`;

  const toggle = el(
    'button',
    'mt-1 h-5 w-5 shrink-0 rounded text-slate-400 hover:bg-slate-700 hover:text-slate-100',
  );
  if (node.childIds.length) {
    toggle.textContent = '▾';
    toggle.setAttribute('aria-expanded', 'true');
  } else {
    toggle.className += ' invisible';
  }
  row.append(toggle);

  const thumbLink = el('a', 'block shrink-0 overflow-hidden rounded bg-slate-800');
  thumbLink.href = linkOf(node);
  thumbLink.target = '_blank';
  thumbLink.rel = 'noopener';
  const thumb = node.isChannel ? node.channel.thumb : node.video?.thumb;
  if (thumb) {
    const img = el(
      'img',
      node.isChannel ? 'h-12 w-12 rounded-full object-cover' : 'h-12 w-[5.3rem] object-cover',
    );
    img.loading = 'lazy';
    img.alt = '';
    img.src = thumb;
    thumbLink.append(img);
  } else {
    thumbLink.append(el('span', 'block h-12 w-[5.3rem] bg-slate-800'));
  }
  row.append(thumbLink);

  const body = el('div', 'min-w-0 flex-1');
  const title = el(
    'a',
    `block truncate text-sm font-medium ${node.unavailable ? 'text-slate-500 italic' : 'text-slate-100 hover:text-sky-300'}`,
    titleOf(node),
  );
  title.href = linkOf(node);
  title.target = '_blank';
  title.rel = 'noopener';
  title.title = titleOf(node);
  body.append(title, meta(node, tree));
  row.append(body);

  li.append(row);

  if (node.childIds.length) {
    const children = el('ul', 'ml-3 space-y-0.5 border-l border-slate-700/70 pl-3');
    children.dataset.children = 'true';
    for (const childId of node.childIds) {
      const child = tree.nodes.get(childId);
      if (child) children.append(renderNode(child, tree));
    }
    li.append(children);
    toggle.addEventListener('click', () => {
      const collapsed = children.classList.toggle('hidden');
      toggle.textContent = collapsed ? '▸' : '▾';
      toggle.setAttribute('aria-expanded', String(!collapsed));
    });
  }

  return li;
}

export function renderList(container, tree) {
  container.replaceChildren();
  const root = tree.nodes.get(tree.rootId);
  if (!root) return;
  const ul = el('ul', 'space-y-0.5');
  ul.append(renderNode(root, tree));
  container.append(ul);
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
