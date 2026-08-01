// UI wiring: settings, crawl lifecycle, view toggle.

import { ApiError, cacheSize, clearCache, resetStats, stats } from './api.js';
import { crawl, crawlChannel } from './crawl.js';
import { parseChannelInput, parseVideoInput } from './extract.js';
import { renderList, setAllExpanded } from './tree-list.js';
import { renderGraph } from './tree-graph.js';

const SETTINGS_KEY = 'ytree:settings';
const API_KEY_KEY = 'ytree:apikey';

const $ = (id) => document.getElementById(id);

const ui = {
  rootVideo: $('root-video'),
  modeHint: $('mode-hint'),
  depthField: $('depth-field'),
  maxDepth: $('max-depth'),
  maxNodes: $('max-nodes'),
  maxChildren: $('max-children'),
  apiKey: $('api-key'),
  start: $('start'),
  cancel: $('cancel'),
  clearCache: $('clear-cache'),
  cacheInfo: $('cache-info'),
  status: $('status'),
  banner: $('banner'),
  empty: $('empty'),
  progress: $('progress'),
  progressPhase: $('progress-phase'),
  progressBar: $('progress-bar'),
  progressDetail: $('progress-detail'),
  progressElapsed: $('progress-elapsed'),
  progressRequests: $('progress-requests'),
  progressStall: $('progress-stall'),
  progressCancel: $('progress-cancel'),
  sideStatus: $('side-status'),
  sidePhase: $('side-phase'),
  sideDetail: $('side-detail'),
  sideCounters: $('side-counters'),
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
};

const ACTIVE_TAB = ['bg-slate-700', 'text-slate-100'];
const IDLE_TAB = ['text-slate-400', 'hover:text-slate-200'];

let tree = null;
let graph = null;
let graphStale = true;
let view = 'list';
let controller = null;

// ---------------------------------------------------------------- settings

function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    /* ignore malformed settings */
  }
  if (saved.rootVideo) ui.rootVideo.value = saved.rootVideo;
  if (saved.maxDepth != null) ui.maxDepth.value = saved.maxDepth;
  if (saved.maxNodes != null) ui.maxNodes.value = saved.maxNodes;
  if (saved.maxChildren != null) ui.maxChildren.value = saved.maxChildren;
  ui.apiKey.value = localStorage.getItem(API_KEY_KEY) || '';
}

function saveSettings() {
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      rootVideo: ui.rootVideo.value,
      maxDepth: ui.maxDepth.value,
      maxNodes: ui.maxNodes.value,
      maxChildren: ui.maxChildren.value,
    }),
  );
  localStorage.setItem(API_KEY_KEY, ui.apiKey.value.trim());
}

/**
 * A channel reference and a video reference are told apart by shape, so one
 * field serves both. Channel mode derives its own depth from the link graph, so
 * the depth control is irrelevant there.
 */
function currentMode() {
  const channel = parseChannelInput(ui.rootVideo.value);
  if (channel) return { kind: 'channel', ref: channel };
  const videoId = parseVideoInput(ui.rootVideo.value);
  return { kind: 'video', videoId };
}

function reflectMode() {
  const mode = currentMode();
  const isChannel = mode.kind === 'channel';
  ui.depthField.classList.toggle('hidden', isChannel);
  ui.modeHint.textContent = isChannel
    ? `Channel mode: loads every upload, then nests each video under whichever video links to it.`
    : '';
  ui.maxNodes.previousElementSibling.textContent = isChannel ? 'Max uploads' : 'Max videos';
  return mode;
}

function num(input, fallback, min, max) {
  const value = Number.parseInt(input.value, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

// -------------------------------------------------------------------- ui

/** In the stacked layout the results pane can sit below the fold — bring
 *  anything the user needs to see up to them rather than hoping they scroll. */
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

function setStatus(text) {
  ui.status.textContent = text;
}

function updateCacheInfo() {
  const count = cacheSize();
  ui.cacheInfo.textContent = count ? `${count} videos cached` : 'Cache empty';
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

  if (!listActive && tree && graphStale) {
    graph = renderGraph(ui.graphPanel, tree);
    graphStale = false;
  }
}

function setRunning(running) {
  ui.start.disabled = running;
  ui.start.textContent = running ? 'Building…' : 'Build tree';
  ui.cancel.classList.toggle('hidden', !running);
}

// --------------------------------------------------------------- progress

const STALL_AFTER_MS = 12000;

let ticker = null;
let startedAt = 0;
let lastChangeAt = 0;

/**
 * The crawl is almost entirely time spent waiting on the API, so the panel
 * reports elapsed time and request count even when no phase has changed —
 * without those, a slow network is indistinguishable from a dead page.
 */
function setProgress({ phase, detail, ratio }) {
  ui.progressPhase.textContent = phase;
  ui.progressDetail.textContent = detail || '';
  ui.sidePhase.textContent = phase;
  ui.sideDetail.textContent = detail || '';
  const known = typeof ratio === 'number' && Number.isFinite(ratio);
  ui.progressBar.classList.toggle('indeterminate', !known);
  ui.progressBar.style.width = known ? `${Math.round(Math.min(1, Math.max(0, ratio)) * 100)}%` : '';
  lastChangeAt = performance.now();
  ui.progressStall.classList.add('hidden');
}

function startProgress() {
  startedAt = performance.now();
  lastChangeAt = startedAt;
  ui.empty.classList.add('hidden');
  ui.progress.classList.remove('hidden');
  ui.progress.classList.add('grid');
  ui.sideStatus.classList.remove('hidden');
  setProgress({ phase: 'Starting…' });
  revealIfOffscreen(ui.progress);

  clearInterval(ticker);
  ticker = setInterval(() => {
    const elapsed = (performance.now() - startedAt) / 1000;
    const counters = `${elapsed.toFixed(1)}s · ${stats.requests} request${stats.requests === 1 ? '' : 's'}`;
    ui.progressElapsed.textContent = `${elapsed.toFixed(1)}s`;
    ui.progressRequests.textContent = `${stats.requests} request${stats.requests === 1 ? '' : 's'}`;
    ui.sideCounters.textContent = counters;
    if (performance.now() - lastChangeAt > STALL_AFTER_MS) {
      ui.progressStall.textContent =
        'Still waiting on googleapis.com — a request can take up to 25s before it gives up.';
      ui.progressStall.classList.remove('hidden');
    }
  }, 100);
}

function stopProgress() {
  clearInterval(ticker);
  ticker = null;
  ui.progress.classList.add('hidden');
  ui.progress.classList.remove('grid');
  ui.sideStatus.classList.add('hidden');
}

function summarise(result) {
  const count = result.mode === 'channel' ? result.nodes.size - 1 : result.nodes.size;
  const parts = [
    `${count} video${count === 1 ? '' : 's'}`,
    `${stats.requests} request${stats.requests === 1 ? '' : 's'}`,
  ];
  if (result.mode === 'channel') {
    const roots = result.nodes.get(result.rootId).childIds.length;
    parts.push(`${roots} top-level`);
  }
  if (stats.cacheHits) parts.push(`${stats.cacheHits} cached`);
  if (result.truncated) parts.push(result.reason);
  return parts.join(' · ');
}

function channelProgress({ phase, count, of }) {
  if (phase === 'channel') {
    return { phase: 'Resolving channel…', detail: 'looking up the uploads playlist' };
  }
  if (phase === 'uploads') {
    return { phase: 'Listing uploads', detail: `${count} videos found so far` };
  }
  if (phase === 'descriptions') {
    return { phase: 'Reading descriptions', detail: `${count} of ${of}`, ratio: count / of };
  }
  if (phase === 'offchannel') {
    return { phase: 'Fetching off-channel links', detail: `${count} of ${of}`, ratio: count / of };
  }
  return { phase: 'Building the tree…' };
}

// ----------------------------------------------------------------- crawl

async function start() {
  const mode = reflectMode();
  if (mode.kind === 'video' && !mode.videoId) {
    showError('That does not look like a YouTube video or channel URL.');
    return;
  }
  const key = ui.apiKey.value.trim();
  if (!key) {
    showError('An API key is required — the YouTube Data API is the only way to read descriptions from a browser.');
    return;
  }

  clearError();
  saveSettings();
  resetStats();
  setRunning(true);
  startProgress();
  controller = new AbortController();

  try {
    const shared = {
      maxNodes: num(ui.maxNodes, 600, 1, 2000),
      maxChildren: num(ui.maxChildren, 10, 1, 50),
      key,
      signal: controller.signal,
    };

    const result =
      mode.kind === 'channel'
        ? await crawlChannel({
            ...shared,
            ref: mode.ref,
            onProgress: (progress) => setProgress(channelProgress(progress)),
          })
        : await crawl({
            ...shared,
            rootId: mode.videoId,
            maxDepth: num(ui.maxDepth, 2, 0, 5),
            onProgress: ({ depth, total, done }) =>
              setProgress(
                done
                  ? { phase: 'Building the tree…' }
                  : { phase: `Crawling depth ${depth}`, detail: `${total} videos found so far` },
              ),
          });

    tree = result;
    graphStale = true;
    setProgress({ phase: 'Rendering…', detail: `${result.nodes.size} nodes` });
    ui.empty.classList.add('hidden');
    renderList(ui.listPanel, tree);
    if (view === 'graph') {
      graph = renderGraph(ui.graphPanel, tree);
      graphStale = false;
    }
    setStatus(summarise(result));
    if (result.nodes.get(mode.videoId)?.unavailable) {
      showError('The root video came back empty — it may be private, deleted, or region-locked.');
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      setStatus('Cancelled.');
    } else if (err instanceof ApiError) {
      showError(err.message);
      setStatus('');
    } else {
      showError(`Unexpected error: ${err.message}`);
      setStatus('');
      console.error(err);
    }
  } finally {
    controller = null;
    setRunning(false);
    stopProgress();
    if (!tree) ui.empty.classList.remove('hidden');
    updateCacheInfo();
  }
}

// --------------------------------------------------------------- events

ui.start.addEventListener('click', start);
ui.cancel.addEventListener('click', () => controller?.abort());
ui.progressCancel.addEventListener('click', () => controller?.abort());
ui.rootVideo.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') start();
});
ui.rootVideo.addEventListener('input', reflectMode);
for (const input of [ui.rootVideo, ui.maxDepth, ui.maxNodes, ui.maxChildren, ui.apiKey]) {
  input.addEventListener('change', saveSettings);
}
ui.clearCache.addEventListener('click', () => {
  const removed = clearCache();
  updateCacheInfo();
  setStatus(removed ? `Cleared ${removed} cached videos.` : 'Cache was already empty.');
});
ui.viewList.addEventListener('click', () => setView('list'));
ui.viewGraph.addEventListener('click', () => setView('graph'));
ui.expandAll.addEventListener('click', () => setAllExpanded(ui.listPanel, true));
ui.collapseAll.addEventListener('click', () => setAllExpanded(ui.listPanel, false));
ui.fit.addEventListener('click', () => graph?.fit());
ui.zoomIn.addEventListener('click', () => graph?.zoomBy(1.25));
ui.zoomOut.addEventListener('click', () => graph?.zoomBy(1 / 1.25));

loadSettings();
reflectMode();
updateCacheInfo();
setView('list');

// Tells the boot-failure check in index.html that the module got this far.
window.__ytreeReady = true;
