// Everything both pages share: rendering a tree, topic chips, search, the
// list/graph toggle and drill-down. The viewer page uses only this; the builder
// page adds crawl controls on top.

import { buildForest } from './placements.js';
import { filterList, renderList, setAllExpanded, startsOf } from './tree-list.js';
import { renderGraph } from './tree-graph.js';
import { extractTopics } from './topics.js';

const TOPIC_CHIPS_COLLAPSED = 24;
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
    topics: $('topics'),
    topicChips: $('topic-chips'),
    topicMore: $('topic-more'),
    topicClear: $('topic-clear'),
  };

  let tree = null;
  let forest = [];
  let graph = null;
  let graphStale = true;
  let view = 'list';
  let focusStack = []; // placements drilled into, newest last
  let topics = [];
  let selectedTopics = new Set();
  let topicsExpanded = false;
  let summary = '';

  // ------------------------------------------------------------- status

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

  // ------------------------------------------------------------- topics

  function renderTopics() {
    ui.topicChips.replaceChildren();
    ui.topics.classList.toggle('hidden', !topics.length);
    if (!topics.length) return;

    const shown = topicsExpanded ? topics : topics.slice(0, TOPIC_CHIPS_COLLAPSED);
    for (const topic of shown) {
      const active = selectedTopics.has(topic.term);
      const chip = document.createElement('button');
      chip.className = `rounded-full border px-2 py-0.5 text-xs transition-colors ${
        active
          ? 'border-sky-500 bg-sky-500/20 text-sky-200'
          : 'border-slate-700 text-slate-300 hover:border-slate-600 hover:bg-slate-800'
      }`;
      chip.textContent = `${topic.label} ${topic.count}`;
      chip.addEventListener('click', () => {
        if (!selectedTopics.delete(topic.term)) selectedTopics.add(topic.term);
        renderTopics();
        applyFilters();
      });
      ui.topicChips.append(chip);
    }

    ui.topicMore.classList.toggle('hidden', topics.length <= TOPIC_CHIPS_COLLAPSED);
    ui.topicMore.textContent = topicsExpanded
      ? 'fewer'
      : `+${topics.length - TOPIC_CHIPS_COLLAPSED} more`;
    ui.topicClear.classList.toggle('hidden', selectedTopics.size === 0);
  }

  /**
   * Selected chips are OR-ed together — picking two topics widens the set —
   * while the search box narrows whatever the chips left. Null means "no filter".
   */
  function buildPredicate() {
    const query = ui.search.value.trim().toLowerCase();
    if (!query && !selectedTopics.size) return null;
    const wanted = topics.filter((topic) => selectedTopics.has(topic.term));
    return (node) => {
      if (wanted.length && !wanted.some((topic) => topic.ids.has(node.id))) return false;
      if (!query) return true;
      return (node.video?.title || '').toLowerCase().includes(query);
    };
  }

  function applyFilters() {
    if (!tree) return;
    const predicate = buildPredicate();
    const listMatches = filterList(ui.listPanel, tree, predicate);
    const graphMatches = graph ? graph.highlight(predicate) : 0;

    if (!predicate) {
      setStatus(summary);
      return;
    }
    const matches = view === 'graph' ? graphMatches : listMatches;
    const bits = [...selectedTopics];
    const query = ui.search.value.trim();
    if (query) bits.push(`“${query}”`);
    const scope = view === 'graph' ? ' in the graph' : '';
    setStatus(`${matches} video${matches === 1 ? '' : 's'}${scope} · ${bits.join(' + ')}`);
  }

  // -------------------------------------------------------------- graph

  function crumbLabel(placement) {
    const node = tree.nodes.get(placement.id);
    const title = node?.video?.title || placement.id;
    return title.length > 34 ? `${title.slice(0, 33)}…` : title;
  }

  function renderCrumbs() {
    ui.crumbs.replaceChildren();
    const showing = view === 'graph' && !!tree;
    ui.crumbs.classList.toggle('hidden', !showing);
    ui.crumbs.classList.toggle('flex', showing);
    if (!showing) return;

    const home = document.createElement(focusStack.length ? 'button' : 'span');
    home.textContent = tree.channel?.title || 'All chains';
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
      const sep = document.createElement('span');
      sep.className = 'text-slate-600';
      sep.textContent = '›';
      ui.crumbs.append(sep);

      const last = index === focusStack.length - 1;
      const crumb = document.createElement(last ? 'span' : 'button');
      crumb.textContent = crumbLabel(placement);
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

    const hint = document.createElement('span');
    hint.className = 'ml-2 text-slate-600';
    hint.textContent = `${graph?.size ?? 0} shown · click a node to drill in · ⌘/Ctrl-click opens YouTube`;
    ui.crumbs.append(hint);
  }

  function drawGraph() {
    if (!tree) return;
    const focused = focusStack[focusStack.length - 1];
    graph = renderGraph(ui.graphPanel, tree, {
      roots: focused ? [focused] : forest,
      predicate: buildPredicate(),
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
    if (buildPredicate()) applyFilters();
  }

  /** Put a tree on screen — from a live crawl or a loaded snapshot. */
  function adopt(next, label) {
    tree = next;
    const built = buildForest(tree, startsOf(tree));
    forest = built.roots;
    graphStale = true;
    focusStack = [];
    ui.search.value = '';
    selectedTopics = new Set();
    topicsExpanded = false;
    topics = extractTopics(tree);
    renderTopics();

    ui.empty.classList.add('hidden');
    renderList(ui.listPanel, tree, forest);
    if (view === 'graph') drawGraph();

    const videos = tree.nodes.size - (tree.nodes.get(tree.rootId)?.isChannel ? 1 : 0);
    const parts = [`${videos} videos`, `${forest.length} chains`];
    if (built.count !== forest.length) parts.push(`${built.count} placements`);
    if (tree.isolatedIds?.length) parts.push(`${tree.isolatedIds.length} unlinked`);
    if (label) parts.push(label);
    if (built.truncated) parts.push('display truncated');
    summary = parts.join(' · ');
    setStatus(summary);
  }

  ui.viewList.addEventListener('click', () => setView('list'));
  ui.viewGraph.addEventListener('click', () => setView('graph'));
  ui.expandAll.addEventListener('click', () => setAllExpanded(ui.listPanel, true));
  ui.collapseAll.addEventListener('click', () => setAllExpanded(ui.listPanel, false));
  ui.fit.addEventListener('click', () => graph?.fit());
  ui.zoomIn.addEventListener('click', () => graph?.zoomBy(1.25));
  ui.zoomOut.addEventListener('click', () => graph?.zoomBy(1 / 1.25));
  ui.search.addEventListener('input', applyFilters);
  ui.topicMore.addEventListener('click', () => {
    topicsExpanded = !topicsExpanded;
    renderTopics();
  });
  ui.topicClear.addEventListener('click', () => {
    selectedTopics.clear();
    renderTopics();
    applyFilters();
  });

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
