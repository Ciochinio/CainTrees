// Everything both pages share: the browse index, search, and the graph.
//
// The organising unit is a section, not the link tree. Picking one shows
// exactly its videos — each once, nested where they link one another — so the
// count on the section header is the number of rows you get.
//
// Sections come from one of two indexes over the same tree: topics mined from
// titles, or the playlists the author made on the channel. The switch between
// them is the only thing that knows the difference.

import { induce } from './induce.js';
import { buildNeighbourhood } from './neighbourhood.js';
import { jumpToVideo, renderPlacement, titleOf } from './tree-list.js';
import { buildPlaylistSections, buildSections, matchingIds } from './sections.js';
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
    browseBy: $('browse-by'),
    browseTopics: $('browse-topics'),
    browsePlaylists: $('browse-playlists'),
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
    detail: $('detail'),
    detailTitle: $('detail-title'),
    detailSub: $('detail-sub'),
    detailWatch: $('detail-watch'),
    detailFocus: $('detail-focus'),
    detailClose: $('detail-close'),
    detailLinks: $('detail-links'),
    neighbourTools: $('neighbour-tools'),
    depthIn: $('depth-in'),
    depthOut: $('depth-out'),
  };

  let tree = null;
  let topicSections = [];
  let playlistSections = [];
  let browseBy = 'topics';
  let sections = [];
  let visible = [];
  let graph = null;
  let graphStale = true;
  let view = 'list';
  let graphTopic = null;
  // Where you've walked: the topic you started from, then each video centred on.
  // Without this there was no way back after following a link.
  let trail = [];
  let summary = '';
  let dataLabel = '';

  /** What a section is called in prose, so status lines read right in both modes. */
  const unit = (count) =>
    browseBy === 'playlists' ? `playlist${count === 1 ? '' : 's'}` : `topic${count === 1 ? '' : 's'}`;

  /** A playlist's order is the author's; a topic's is whatever reads best. */
  const layout = (section, ids) => induce(tree, ids, { preserveOrder: !!section?.ordered });

  const centred = () => (trail.length ? trail[trail.length - 1] : null);
  const depthIn = () => Number(ui.depthIn?.value ?? 1);
  const depthOut = () => Number(ui.depthOut?.value ?? 1);

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

      // A playlist can name videos this crawl doesn't hold — someone else's
      // upload, a deleted one, anything past the upload cap. Say so rather than
      // quietly showing a smaller number than YouTube does.
      const absent = !test && section.itemCount ? section.itemCount - section.videos : 0;
      if (absent > 0) {
        header.append(el('span', 'text-xs text-slate-600', `${absent} not in this snapshot`));
      }

      const body = document.createElement('ul');
      body.className = 'hidden space-y-0.5 pb-2 pl-2';

      let built = false;
      const toggle = (force) => {
        const open = force ?? body.classList.contains('hidden');
        if (open && !built) {
          const { roots } = layout(section, ids);
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

  // -------------------------------------------------------- detail panel

  let detailId = null;

  function closeDetail() {
    detailId = null;
    ui.detail.classList.add('hidden');
  }

  /**
   * Centre the graph on a video: its own links out and in, regardless of which
   * topic anything belongs to. Following a reference used to dump you into the
   * destination's topic, which was arbitrary and lost your place.
   */
  function centreOn(videoId) {
    if (!tree.nodes.has(videoId)) return;
    if (centred() !== videoId) trail = [...trail, videoId];
    if (view !== 'graph') setView('graph');
    graphStale = true;
    drawGraph();
    openDetail(videoId);
  }

  /** Drop back to a point on the trail — index -1 means the topic itself. */
  function backTo(index) {
    trail = index < 0 ? [] : trail.slice(0, index + 1);
    graphStale = true;
    drawGraph();
    if (trail.length) openDetail(centred());
    else closeDetail();
  }

  function linkRow(videoId) {
    const node = tree.nodes.get(videoId);
    const button = el(
      'button',
      'flex w-full items-start gap-2 rounded p-1.5 text-left hover:bg-slate-800',
    );
    const label = el('span', 'min-w-0 flex-1 text-xs text-slate-200', titleOf(node));
    button.append(label);

    const host = sections.find((section) => section.ids.has(videoId));
    if (host) {
      button.append(el('span', 'shrink-0 rounded bg-slate-700/70 px-1.5 py-0.5 text-[10px] text-slate-300', host.label));
    }
    // Show the video, don't travel to it — walking is what "Centre on this" is
    // for, and doing it automatically left that button with no purpose.
    button.addEventListener('click', () => {
      openDetail(videoId);
      graph?.select(videoId);
    });
    return button;
  }

  function openDetail(videoId) {
    const node = tree.nodes.get(videoId);
    if (!node) return;
    detailId = videoId;

    ui.detailTitle.textContent = titleOf(node);
    const bits = [node.video?.channelTitle, node.video?.publishedAt?.slice(0, 10)].filter(Boolean);
    if (node.offChannel) bits.push('off-channel');
    ui.detailSub.textContent = bits.join(' · ');
    ui.detailWatch.href = `https://www.youtube.com/watch?v=${videoId}`;

    ui.detailLinks.replaceChildren();
    const group = (heading, ids) => {
      if (!ids.length) return;
      const wrap = el('div');
      wrap.append(el('p', 'mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-500', heading));
      for (const id of ids) if (tree.nodes.has(id)) wrap.append(linkRow(id));
      ui.detailLinks.append(wrap);
    };
    group(`Links to (${node.links.length})`, node.links);
    group(`Linked from (${node.incoming.length})`, node.incoming);
    if (!node.links.length && !node.incoming.length) {
      ui.detailLinks.append(el('p', 'text-xs text-slate-500', 'No links in or out.'));
    }

    ui.detail.classList.remove('hidden');
  }

  // --------------------------------------------------------------- graph

  // An empty term means "no topic picked" — the graph is then driven by the
  // search box instead, so you can find a video without knowing its topic.
  const sectionFor = (term) => (term ? sections.find((section) => section.term === term) : null);

  const HUB_COUNT = 20;

  function fillTopicSelect() {
    if (!ui.topicSelect) return;
    ui.topicSelect.replaceChildren();
    const any = document.createElement('option');
    any.value = '';
    any.textContent = 'Any topic';
    ui.topicSelect.append(any);
    for (const section of sections) {
      const option = document.createElement('option');
      option.value = section.term;
      option.textContent = `${section.label} (${section.videos})`;
      ui.topicSelect.append(option);
    }
    ui.topicSelect.value = graphTopic || '';
  }

  /** Which videos the graph draws when it isn't centred on one. */
  function graphIds() {
    const test = predicate();
    const section = sectionFor(graphTopic);
    if (section) return matchingIds(tree, section, test);

    const videos = [];
    for (const node of tree.nodes.values()) {
      if (node.isChannel || !node.video) continue;
      if (!test || test(node)) videos.push(node);
    }
    if (test) return new Set(videos.map((node) => node.id));

    // Nothing picked and nothing typed: open on the busiest videos, which are
    // at least a useful place to start walking from.
    return new Set(
      videos
        .sort((a, b) => b.incoming.length + b.links.length - (a.incoming.length + a.links.length))
        .slice(0, HUB_COUNT)
        .map((node) => node.id),
    );
  }

  function selectGraphTopic(term) {
    // Re-picking the topic you're already on is how you get back out of a walk,
    // so only bail when there's genuinely nothing to change.
    if (graphTopic === term && !trail.length) return;
    graphTopic = term;
    if (ui.topicSelect) ui.topicSelect.value = term;
    trail = [];
    graphStale = true;
    if (view === 'graph') drawGraph();
  }

  const TRAIL_VISIBLE = 4;

  function renderCrumbs() {
    ui.crumbs.replaceChildren();
    const showing = view === 'graph' && !!tree;
    ui.crumbs.classList.toggle('hidden', !showing);
    ui.crumbs.classList.toggle('flex', showing);
    if (!showing) return;

    if (trail.length) {
      const back = el('button', 'rounded border border-slate-700 px-1.5 py-0.5 text-slate-300 hover:bg-slate-800', '← Back');
      back.addEventListener('click', () => backTo(trail.length - 2));
      ui.crumbs.append(back);
    }

    const section = sectionFor(graphTopic);
    const atTopic = trail.length === 0;
    const query = ui.search.value.trim();
    const home = document.createElement(atTopic ? 'span' : 'button');
    home.textContent = section
      ? section.label
      : query
        ? `matches for “${query}”`
        : 'Most linked';
    home.className = atTopic
      ? 'font-medium text-slate-200'
      : 'rounded px-1 text-slate-400 underline-offset-2 hover:text-sky-300 hover:underline';
    if (!atTopic) home.addEventListener('click', () => backTo(-1));
    ui.crumbs.append(home);

    // Only the tail of a long walk is worth showing.
    const start = Math.max(0, trail.length - TRAIL_VISIBLE);
    if (start > 0) ui.crumbs.append(el('span', 'text-slate-600', '› …'));

    trail.slice(start).forEach((videoId, offset) => {
      const index = start + offset;
      ui.crumbs.append(el('span', 'text-slate-600', '›'));
      const last = index === trail.length - 1;
      const label = titleOf(tree.nodes.get(videoId));
      const crumb = document.createElement(last ? 'span' : 'button');
      crumb.textContent = label.length > 28 ? `${label.slice(0, 27)}…` : label;
      crumb.className = last
        ? 'font-medium text-slate-200'
        : 'rounded px-1 text-slate-400 underline-offset-2 hover:text-sky-300 hover:underline';
      if (!last) crumb.addEventListener('click', () => backTo(index));
      ui.crumbs.append(crumb);
    });

    ui.crumbs.append(
      el(
        'span',
        'ml-2 text-slate-600',
        `${graph?.size ?? 0} shown · click a node for details · middle-click to watch`,
      ),
    );
  }

  function drawGraph() {
    if (!tree) return;
<<<<<<< Updated upstream
    const centre = centred();

    if (centre) {
      const hood = buildNeighbourhood(tree, centre, { inDepth: depthIn(), outDepth: depthOut() });
      graph = renderGraph(ui.graphPanel, tree, {
        hood,
        // Same gesture as everywhere else: show the video. Travelling is always
        // the explicit "Centre on this" button, never a side effect of a click.
        onSelect: (placement) => openDetail(placement.id),
      });
    } else {
      const { roots } = induce(tree, graphIds());
      graph = renderGraph(ui.graphPanel, tree, {
        roots,
        onSelect: (placement) => openDetail(placement.id),
      });
    }
=======
    const section = sectionFor(graphTopic);
    if (!section) return;
    const ids = matchingIds(tree, section, predicate());
    const { roots } = layout(section, ids);
    const focused = focusStack[focusStack.length - 1];
>>>>>>> Stashed changes

    graphStale = false;
    if (centre) graph.select(centre);
    else if (detailId) graph.select(detailId);
    ui.neighbourTools?.classList.toggle('hidden', !centre);
    ui.neighbourTools?.classList.toggle('flex', !!centre);
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

    if (listActive) closeDetail(); // the panel overlays the results area
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
      `${videos.size} video${videos.size === 1 ? '' : 's'} in ${visible.length} ${unit(
        visible.length,
      )} · “${ui.search.value.trim()}”`,
    );
  }

  function describe() {
    const videos = tree.nodes.size - (tree.nodes.get(tree.rootId)?.isChannel ? 1 : 0);
    const parts = [`${videos} videos`, `${sections.length} ${unit(sections.length)}`];
    if (dataLabel) parts.push(dataLabel);
    return parts.join(' · ');
  }

  /**
   * Swap which index the page is browsing. Both are built up front from the same
   * tree, so this is only ever a re-render — never a refetch.
   */
  function setBrowse(mode) {
    browseBy = playlistSections.length && mode === 'playlists' ? 'playlists' : 'topics';
    sections = browseBy === 'playlists' ? playlistSections : topicSections;
    graphTopic = sections[0]?.term || null;
    focusStack = [];
    graphStale = true;
    closeDetail();

    const onPlaylists = browseBy === 'playlists';
    ui.browseTopics?.classList.remove(...ACTIVE_TAB, ...IDLE_TAB);
    ui.browsePlaylists?.classList.remove(...ACTIVE_TAB, ...IDLE_TAB);
    ui.browseTopics?.classList.add(...(onPlaylists ? IDLE_TAB : ACTIVE_TAB));
    ui.browsePlaylists?.classList.add(...(onPlaylists ? ACTIVE_TAB : IDLE_TAB));
    if (ui.topicSelect) {
      ui.topicSelect.setAttribute('aria-label', onPlaylists ? 'Playlist to draw' : 'Topic to draw');
    }

    fillTopicSelect();
    summary = describe();
    applySearch(); // re-renders the list, redraws the graph, and restates the count
  }

  /** Put a tree on screen — from a live crawl or a loaded snapshot. */
  function adopt(next, label) {
    tree = next;
<<<<<<< Updated upstream
    sections = buildSections(tree, extractTopics(tree));
    visible = sections;
    graphTopic = ''; // start unfiltered so search can reach the whole channel
    graphStale = true;
    trail = [];
=======
    dataLabel = label || '';
    topicSections = buildSections(tree, extractTopics(tree));
    playlistSections = buildPlaylistSections(tree);
>>>>>>> Stashed changes
    ui.search.value = '';

    // Video-mode crawls and snapshots taken before playlists existed have none,
    // and then there's nothing to switch between.
    const hasPlaylists = playlistSections.length > 0;
    ui.browseBy?.classList.toggle('hidden', !hasPlaylists);
    ui.browseBy?.classList.toggle('flex', hasPlaylists);
    if (ui.browsePlaylists) {
      const count = playlistSections.filter((section) => !section.isOrphanBucket).length;
      ui.browsePlaylists.textContent = hasPlaylists ? `Playlists (${count})` : 'Playlists';
    }

    ui.empty.classList.add('hidden');
    setBrowse(browseBy);
  }

  ui.viewList.addEventListener('click', () => setView('list'));
  ui.viewGraph.addEventListener('click', () => setView('graph'));
  ui.browseTopics?.addEventListener('click', () => tree && setBrowse('topics'));
  ui.browsePlaylists?.addEventListener('click', () => tree && setBrowse('playlists'));
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
  ui.detailClose.addEventListener('click', closeDetail);
  ui.detailFocus.addEventListener('click', () => {
<<<<<<< Updated upstream
    if (detailId) centreOn(detailId);
  });
  ui.depthIn?.addEventListener('change', () => {
    graphStale = true;
    drawGraph();
  });
  ui.depthOut?.addEventListener('change', () => {
    graphStale = true;
=======
    if (!detailId) return;
    const section = sectionFor(graphTopic);
    const { placed } = layout(section, matchingIds(tree, section, predicate()));
    const placement = placed.get(detailId);
    if (!placement) return;
    focusStack = [...focusStack, placement];
>>>>>>> Stashed changes
    drawGraph();
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
