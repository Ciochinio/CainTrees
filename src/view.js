// Everything both pages share: the topic-grouped list, search, the graph and
// its drill-down. The viewer page uses only this; the builder adds crawl
// controls on top.

import { buildForest } from './placements.js';
import { renderPlacement, startsOf } from './tree-list.js';
import { buildSections, countMatches, filterSections } from './sections.js';
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
  let forest = [];
  let sections = [];
  let visible = []; // sections after the search filter
  let graph = null;
  let graphStale = true;
  let view = 'list';
  let focusStack = [];
  let graphTopic = null; // which section the graph is drawing
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

  // --------------------------------------------------------------- list

  /**
   * Sections render collapsed and fill in their chains the first time they're
   * opened. With a video repeating in every topic it carries, building all of
   * them up front would be tens of thousands of rows for nothing.
   */
  function renderSectionList() {
    ui.listPanel.replaceChildren();
    const test = predicate();

    if (!visible.length) {
      ui.listPanel.append(
        Object.assign(document.createElement('p'), {
          className: 'p-4 text-sm text-slate-500',
          textContent: 'Nothing matches.',
        }),
      );
      return;
    }

    for (const section of visible) {
      const block = document.createElement('section');
      block.className = 'border-b border-slate-800/70';

      const header = document.createElement('button');
      header.className =
        'flex w-full items-center gap-2 rounded px-1.5 py-2 text-left hover:bg-slate-800/40';
      const caret = document.createElement('span');
      caret.className = 'w-3 shrink-0 text-slate-500';
      caret.textContent = '▸';

      const name = document.createElement('span');
      name.className = section.isOrphanBucket
        ? 'text-sm font-medium text-slate-400'
        : 'text-sm font-medium text-slate-100';
      name.textContent = section.label;

      const count = document.createElement('span');
      count.className = 'text-xs text-slate-500';
      const matched = countMatches(tree, section, test);
      count.textContent = test
        ? `${matched} matching · ${section.roots.length} chain${section.roots.length === 1 ? '' : 's'}`
        : `${section.videos} video${section.videos === 1 ? '' : 's'} · ${section.roots.length} chain${section.roots.length === 1 ? '' : 's'}`;

      header.append(caret, name, count);

      const body = document.createElement('ul');
      body.className = 'hidden space-y-0.5 pb-2 pl-2';
      body.dataset.sectionBody = section.term;

      let built = false;
      const toggle = (force) => {
        const open = force ?? body.classList.contains('hidden');
        if (open && !built) {
          for (const root of section.roots) body.append(renderPlacement(root, tree));
          built = true;
        }
        body.classList.toggle('hidden', !open);
        caret.textContent = open ? '▾' : '▸';
      };
      header.addEventListener('click', () => {
        toggle();
        // Opening a topic in the list is also how you pick one for the graph.
        if (!body.classList.contains('hidden')) selectGraphTopic(section.term);
      });

      block.append(header, body);
      ui.listPanel.append(block);

      // A search should show its hits, not make you open 40 sections by hand.
      if (test && visible.length <= 8) toggle(true);
    }
  }

  // -------------------------------------------------------------- graph

  function sectionFor(term) {
    return sections.find((section) => section.term === term) || sections[0] || null;
  }

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

  function crumbLabel(placement) {
    const title = tree.nodes.get(placement.id)?.video?.title || placement.id;
    return title.length > 34 ? `${title.slice(0, 33)}…` : title;
  }

  function renderCrumbs() {
    ui.crumbs.replaceChildren();
    const showing = view === 'graph' && !!tree;
    ui.crumbs.classList.toggle('hidden', !showing);
    ui.crumbs.classList.toggle('flex', showing);
    if (!showing) return;

    const section = sectionFor(graphTopic);
    const home = document.createElement(focusStack.length ? 'button' : 'span');
    home.textContent = section ? section.label : 'All chains';
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
    const section = sectionFor(graphTopic);
    const focused = focusStack[focusStack.length - 1];
    graph = renderGraph(ui.graphPanel, tree, {
      roots: focused ? [focused] : section ? section.roots : forest,
      predicate: predicate(),
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
    visible = filterSections(tree, sections, test);
    renderSectionList();
    if (view === 'graph') drawGraph();

    if (!test) {
      setStatus(summary);
      return;
    }
    const videos = new Set();
    for (const section of visible) {
      for (const root of section.roots) {
        const stack = [root];
        while (stack.length) {
          const placement = stack.pop();
          const node = tree.nodes.get(placement.id);
          if (node && test(node)) videos.add(placement.id);
          stack.push(...placement.children);
        }
      }
    }
    setStatus(
      `${videos.size} video${videos.size === 1 ? '' : 's'} in ${visible.length} topic${visible.length === 1 ? '' : 's'} · “${ui.search.value.trim()}”`,
    );
  }

  /** Put a tree on screen — from a live crawl or a loaded snapshot. */
  function adopt(next, label) {
    tree = next;
    const built = buildForest(tree, startsOf(tree));
    forest = built.roots;
    sections = buildSections(tree, forest, extractTopics(tree));
    visible = sections;
    graphTopic = sections[0]?.term || null;
    graphStale = true;
    focusStack = [];
    ui.search.value = '';

    ui.empty.classList.add('hidden');
    fillTopicSelect();
    renderSectionList();
    if (view === 'graph') drawGraph();

    const videos = tree.nodes.size - (tree.nodes.get(tree.rootId)?.isChannel ? 1 : 0);
    const parts = [
      `${videos} videos`,
      `${sections.length} topics`,
      `${forest.length} linked chain${forest.length === 1 ? '' : 's'}`,
    ];
    if (label) parts.push(label);
    if (built.truncated) parts.push('display truncated');
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
