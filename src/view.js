// Everything both pages share: the topic index, search, and the graph.
//
// The organising unit is a topic, not the link tree. Picking a topic shows
// exactly its videos — each once, nested where they link one another — so the
// count on the section header is the number of rows you get.

import { induce } from './induce.js';
import { jumpToVideo, renderPlacement, titleOf } from './tree-list.js';
import { buildSections, matchingIds } from './sections.js';
import { renderGraph } from './tree-graph.js';
import { extractTopics } from './topics.js';

const ACTIVE_TAB = ['bg-slate-700', 'text-slate-100'];
const IDLE_TAB = ['text-slate-400', 'hover:text-slate-200'];

const $ = (id) => document.getElementById(id);

export function createView() {
  const ui = {
    status: $('status'),
    banner: $('banner'),
    empty: $('empty'),
    viewList: $('view-list'),
    viewGraph: $('view-graph'),
    listTools: $('list-tools'),
    graphTools: $('graph-tools'),
    listPanel: $('list-panel'),
    graphPanel: $('graph-panel'),
    expandAll: $('expand-all'),
    collapseAll: $('collapse-all'),
    fit: $('fit'),
    zoomIn: $('zoom-in'),
    zoomOut: $('zoom-out'),
    search: $('search'),
    crumbs: $('crumbs'),
    topicSelect: $('topic-select'),
  };

  let tree = null;
  let sections = [];
  let visible = [];
  let graph = null;
  let graphStale = true;
  let view = 'list';
  let graphTopic = null;
  let focusStack = [];
  let summary = '';

  const setStatus = (text) => {
    ui.status.textContent = text;
  };

  function revealIfOffscreen(element) {
    const box = element.getBoundingClientRect();
    if (box.top >= 0 && box.bottom <= window.innerHeight) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function showError(message) {
    ui.banner.textContent = message;
    ui.banner.classList.remove('hidden');
    revealIfOffscreen(ui.banner);
  }

  function clearError() {
    ui.banner.classList.add('hidden');
    ui.banner.textContent = '';
  }

  function showEmpty(message) {
    ui.empty.textContent = message;
    ui.empty.classList.remove('hidden');
  }

  function predicate() {
    const query = ui.search.value.trim().toLowerCase();
    if (!query) return null;
    return (node) => (node.video?.title || '').toLowerCase().includes(query);
  }

  /** Follow a link to a video that isn't in the open section. */
  function openVideo(videoId) {
    if (jumpToVideo(videoId)) return;
    const host = sections.find((section) => section.ids.has(videoId));
    if (!host) return;
    const header = ui.listPanel.querySelector(`[data-section="${CSS.escape(host.term)}"]`);
    if (!header) return;
    if (header.nextElementSibling.classList.contains('hidden')) header.click();
    setTimeout(() => jumpToVideo(videoId), 60);
  }

  // ---------------------------------------------------------------- list

  function renderSections() {
    ui.listPanel.replaceChildren();
    const test = predicate();

    if (!visible.length) {
      ui.listPanel.append(el('p', 'p-4 text-sm text-slate-500', 'Nothing matches.'));
      return;
    }

    for (const section of visible) {
      const ids = matchingIds(tree, section, test);
      const block = document.createElement('section');
      block.className = 'border-b border-slate-800/70';

      const header = document.createElement('button');
      header.className = 'flex w-full items-center gap-2 rounded px-1.5 py-2 text-left hover:bg-slate-800/40';
      header.dataset.section = section.term;

      const caret = el('span', 'w-3 shrink-0 text-slate-500', '▸');
      const name = el(
        'span',
        section.isOrphanBucket ? 'text-sm font-medium text-slate-400' : 'text-sm font-medium text-slate-100',
        section.label,
      );
      const count = el(
        'span',
        'text-xs text-slate-500',
        `${ids.size} video${ids.size === 1 ? '' : 's'}${test ? ' matching' : ''}`,
      );
      header.append(caret, name, count);

      const body = document.createElement('ul');
      body.className = 'hidden space-y-0.5 pb-2 pl-2';

      let built = false;
      const toggle = (force) => {
        const open = force ?? body.classList.contains('hidden');
        if (open && !built) {
          const { roots } = induce(tree, ids);
          for (const root of roots) body.append(renderPlacement(root, tree, openVideo));
          built = true;
        }
        body.classList.toggle('hidden', !open);
        caret.textContent = open ? '▾' : '▸';
      };
      header.addEventListener('click', () => {
        toggle();
        if (!body.classList.contains('hidden')) selectGraphTopic(section.term);
      });

      block.append(header, body);
      ui.listPanel.append(block);

      if (test && visible.length <= 8) toggle(true);
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  // --------------------------------------------------------------- graph

  const sectionFor = (term) => sections.find((section) => section.term === term) || sections[0] || null;

  function fillTopicSelect() {
    if (!ui.topicSelect) return;
    ui.topicSelect.replaceChildren();
    for (const section of sections) {
      const option = document.createElement('option');
      option.value = section.term;
      option.textContent = `${section.label} (${section.videos})`;
      ui.topicSelect.append(option);
    }
    if (graphTopic) ui.topicSelect.value = graphTopic;
  }

  function selectGraphTopic(term) {
    if (graphTopic === term) return;
    graphTopic = term;
    if (ui.topicSelect) ui.topicSelect.value = term;
    focusStack = [];
    graphStale = true;
    if (view === 'graph') drawGraph();
  }

  function renderCrumbs() {
    ui.crumbs.replaceChildren();
    const showing = view === 'graph' && !!tree;
    ui.crumbs.classList.toggle('hidden', !showing);
    ui.crumbs.classList.toggle('flex', showing);
    if (!showing) return;

    const section = sectionFor(graphTopic);
    const home = document.createElement(focusStack.length ? 'button' : 'span');
    home.textContent = section ? section.label : 'All videos';
    home.className = focusStack.length
      ? 'rounded px-1 text-slate-400 underline-offset-2 hover:text-sky-300 hover:underline'
      : 'font-medium text-slate-200';
    if (focusStack.length) {
      home.addEventListener('click', () => {
        focusStack = [];
        drawGraph();
      });
    }
    ui.crumbs.append(home);

    focusStack.forEach((placement, index) => {
      ui.crumbs.append(el('span', 'text-slate-600', '›'));
      const last = index === focusStack.length - 1;
      const label = titleOf(tree.nodes.get(placement.id));
      const crumb = document.createElement(last ? 'span' : 'button');
      crumb.textContent = label.length > 34 ? `${label.slice(0, 33)}…` : label;
      crumb.className = last
        ? 'font-medium text-slate-200'
        : 'rounded px-1 text-slate-400 underline-offset-2 hover:text-sky-300 hover:underline';
      if (!last) {
        crumb.addEventListener('click', () => {
          focusStack = focusStack.slice(0, index + 1);
          drawGraph();
        });
      }
      ui.crumbs.append(crumb);
    });

    ui.crumbs.append(
      el(
        'span',
        'ml-2 text-slate-600',
        `${graph?.size ?? 0} shown · click a node to drill in · ⌘/Ctrl-click opens YouTube`,
      ),
    );
  }

  function drawGraph() {
    if (!tree) return;
    const section = sectionFor(graphTopic);
    if (!section) return;
    const ids = matchingIds(tree, section, predicate());
    const { roots } = induce(tree, ids);
    const focused = focusStack[focusStack.length - 1];

    graph = renderGraph(ui.graphPanel, tree, {
      roots: focused ? [focused] : roots,
      onFocus: (placement) => {
        focusStack = [...focusStack, placement];
        drawGraph();
      },
    });
    graphStale = false;
    renderCrumbs();
  }

  function setView(next) {
    view = next;
    const listActive = next === 'list';
    ui.listPanel.classList.toggle('hidden', !listActive);
    ui.graphPanel.classList.toggle('hidden', listActive);
    ui.listTools.classList.toggle('hidden', !listActive);
    ui.graphTools.classList.toggle('hidden', listActive);
    ui.graphTools.classList.toggle('flex', !listActive);

    ui.viewList.classList.remove(...ACTIVE_TAB, ...IDLE_TAB);
    ui.viewGraph.classList.remove(...ACTIVE_TAB, ...IDLE_TAB);
    ui.viewList.classList.add(...(listActive ? ACTIVE_TAB : IDLE_TAB));
    ui.viewGraph.classList.add(...(listActive ? IDLE_TAB : ACTIVE_TAB));

    if (!listActive && tree && graphStale) drawGraph();
    else renderCrumbs();
  }

  function applySearch() {
    if (!tree) return;
    const test = predicate();
    visible = test
      ? sections.filter((section) => matchingIds(tree, section, test).size)
      : sections;
    renderSections();
    if (view === 'graph') drawGraph();

    if (!test) {
      setStatus(summary);
      return;
    }
    const videos = new Set();
    for (const section of visible) for (const id of matchingIds(tree, section, test)) videos.add(id);
    setStatus(
      `${videos.size} video${videos.size === 1 ? '' : 's'} in ${visible.length} topic${
        visible.length === 1 ? '' : 's'
      } · “${ui.search.value.trim()}”`,
    );
  }

  /** Put a tree on screen — from a live crawl or a loaded snapshot. */
  function adopt(next, label) {
    tree = next;
    sections = buildSections(tree, extractTopics(tree));
    visible = sections;
    graphTopic = sections[0]?.term || null;
    graphStale = true;
    focusStack = [];
    ui.search.value = '';

    ui.empty.classList.add('hidden');
    fillTopicSelect();
    renderSections();
    if (view === 'graph') drawGraph();

    const videos = tree.nodes.size - (tree.nodes.get(tree.rootId)?.isChannel ? 1 : 0);
    const parts = [`${videos} videos`, `${sections.length} topics`];
    if (label) parts.push(label);
    summary = parts.join(' · ');
    setStatus(summary);
  }

  ui.viewList.addEventListener('click', () => setView('list'));
  ui.viewGraph.addEventListener('click', () => setView('graph'));
  ui.expandAll.addEventListener('click', () => {
    for (const header of ui.listPanel.querySelectorAll('section > button')) {
      if (header.nextElementSibling?.classList.contains('hidden')) header.click();
    }
  });
  ui.collapseAll.addEventListener('click', () => {
    for (const header of ui.listPanel.querySelectorAll('section > button')) {
      if (!header.nextElementSibling?.classList.contains('hidden')) header.click();
    }
  });
  ui.fit.addEventListener('click', () => graph?.fit());
  ui.zoomIn.addEventListener('click', () => graph?.zoomBy(1.25));
  ui.zoomOut.addEventListener('click', () => graph?.zoomBy(1 / 1.25));
  ui.search.addEventListener('input', applySearch);
  ui.topicSelect?.addEventListener('change', () => selectGraphTopic(ui.topicSelect.value));

  setView('list');

  return {
    adopt,
    setStatus,
    showError,
    clearError,
    showEmpty,
    hasTree: () => !!tree,
    getTree: () => tree,
  };
}
